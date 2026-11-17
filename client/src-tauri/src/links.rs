use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;
use tokio::sync::Mutex;
use url::Url;

const MAX_REDIRECTS: usize = 5;
const MAX_HTML_BYTES: usize = 262_144;
const MAX_CACHE_ENTRIES: usize = 500;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
  pub url: String,
  pub title: Option<String>,
  pub description: Option<String>,
  pub site_name: Option<String>,
  pub image: Option<String>,
  pub icon: Option<String>,
}

pub struct LinkPreviewState {
  client: reqwest::Client,
  cache: Mutex<HashMap<String, LinkPreview>>,
}

impl Default for LinkPreviewState {
  fn default() -> Self {
    let client = reqwest::Client::builder()
      .redirect(reqwest::redirect::Policy::none())
      .timeout(Duration::from_secs(6))
      .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
      .build()
      .unwrap_or_default();
    Self {
      client,
      cache: Mutex::new(HashMap::new()),
    }
  }
}

#[derive(serde::Deserialize)]
struct OEmbedResponse {
  title: Option<String>,
  author_name: Option<String>,
  provider_name: Option<String>,
  thumbnail_url: Option<String>,
  html: Option<String>,
}

pub fn parse_http_url(raw: &str) -> Result<Url, String> {
  let parsed = Url::parse(raw.trim()).map_err(|_| "Invalid URL.".to_string())?;
  match parsed.scheme() {
    "http" | "https" => Ok(parsed),
    _ => Err("Only http and https URLs are allowed.".to_string()),
  }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
  let octets = ip.octets();
  let cgnat = octets[0] == 100 && (octets[1] & 0b1100_0000) == 64;
  !ip.is_private()
    && !ip.is_loopback()
    && !ip.is_link_local()
    && !ip.is_broadcast()
    && !ip.is_documentation()
    && !ip.is_unspecified()
    && !ip.is_multicast()
    && !cgnat
    && octets[0] < 240
}

fn is_public_ip(ip: IpAddr) -> bool {
  match ip {
    IpAddr::V4(v4) => is_public_v4(v4),
    IpAddr::V6(v6) => {
      if let Some(v4) = v6.to_ipv4_mapped() {
        return is_public_v4(v4);
      }
      let seg0 = v6.segments()[0];
      let unique_local = (seg0 & 0xfe00) == 0xfc00;
      let link_local = (seg0 & 0xffc0) == 0xfe80;
      !v6.is_loopback() && !v6.is_unspecified() && !v6.is_multicast() && !unique_local && !link_local
    }
  }
}

fn is_disallowed_hostname(host: &str) -> bool {
  let lower = host.trim_end_matches('.').to_ascii_lowercase();
  lower.is_empty()
    || lower == "localhost"
    || lower.ends_with(".localhost")
    || lower.ends_with(".local")
    || lower.ends_with(".internal")
}

async fn validate_public_url(url: &Url) -> Result<(), String> {
  if url.scheme() != "http" && url.scheme() != "https" {
    return Err("Unsupported URL scheme.".to_string());
  }
  let host = url.host_str().ok_or_else(|| "Missing host.".to_string())?;
  if is_disallowed_hostname(host) {
    return Err("Local hosts are not allowed.".to_string());
  }
  if let Ok(ip) = host.trim_matches(|c| c == '[' || c == ']').parse::<IpAddr>() {
    if !is_public_ip(ip) {
      return Err("Private addresses are not allowed.".to_string());
    }
    return Ok(());
  }
  let port = url.port_or_known_default().unwrap_or(80);
  let addrs: Vec<_> = tokio::net::lookup_host((host, port))
    .await
    .map_err(|_| "Could not resolve host.".to_string())?
    .collect();
  if addrs.is_empty() || !addrs.iter().all(|addr| is_public_ip(addr.ip())) {
    return Err("Host did not resolve to a public address.".to_string());
  }
  Ok(())
}

fn sanitize_asset_url(base: &Url, raw: Option<String>) -> Option<String> {
  let candidate = raw?;
  let trimmed = candidate.trim();
  if trimmed.is_empty() {
    return None;
  }
  let joined = base.join(trimmed).ok()?;
  if joined.scheme() != "http" && joined.scheme() != "https" {
    return None;
  }
  let host = joined.host_str()?;
  if is_disallowed_hostname(host) {
    return None;
  }
  if let Ok(ip) = host.trim_matches(|c| c == '[' || c == ']').parse::<IpAddr>() {
    if !is_public_ip(ip) {
      return None;
    }
  }
  Some(joined.to_string())
}

fn oembed_endpoint(url: &Url) -> Option<String> {
  let host = url.host_str()?.to_ascii_lowercase();
  let host = host.strip_prefix("www.").unwrap_or(&host);
  let host = host.strip_prefix("m.").unwrap_or(host);
  let mut target = if host == "youtube.com" || host == "youtu.be" {
    Url::parse("https://www.youtube.com/oembed").ok()?
  } else if host == "open.spotify.com" {
    Url::parse("https://open.spotify.com/oembed").ok()?
  } else if host == "vimeo.com" {
    Url::parse("https://vimeo.com/api/oembed.json").ok()?
  } else if (host == "x.com" || host == "twitter.com") && url.path().contains("/status/") {
    Url::parse("https://publish.twitter.com/oembed").ok()?
  } else {
    return None;
  };
  {
    let mut pairs = target.query_pairs_mut();
    pairs.append_pair("url", url.as_str());
    pairs.append_pair("format", "json");
    if host == "x.com" || host == "twitter.com" {
      pairs.append_pair("omit_script", "true");
    }
  }
  Some(target.to_string())
}

async fn try_oembed(client: &reqwest::Client, target: &Url) -> Option<LinkPreview> {
  let endpoint = oembed_endpoint(target)?;
  let response = client
    .get(&endpoint)
    .timeout(Duration::from_secs(4))
    .header("Accept", "application/json")
    .send()
    .await
    .ok()?;
  if !response.status().is_success() {
    return None;
  }
  let data: OEmbedResponse = response.json().await.ok()?;
  let snippet = data.html.as_deref().and_then(extract_blockquote_paragraph);
  let title = clean_text(data.title.as_deref()).or_else(|| clean_text(data.author_name.as_deref()));
  let description = if title.as_deref() == clean_text(data.author_name.as_deref()).as_deref() {
    snippet
  } else {
    snippet.or_else(|| clean_text(data.author_name.as_deref()))
  };
  if title.is_none() && data.thumbnail_url.is_none() && description.is_none() {
    return None;
  }
  Some(LinkPreview {
    url: target.to_string(),
    title,
    description,
    site_name: clean_text(data.provider_name.as_deref()),
    image: sanitize_asset_url(target, data.thumbnail_url),
    icon: None,
  })
}

pub async fn fetch_preview(state: &LinkPreviewState, raw_url: &str) -> Result<LinkPreview, String> {
  let initial = parse_http_url(raw_url)?;
  let key = initial.to_string();
  if let Some(cached) = state.cache.lock().await.get(&key).cloned() {
    return Ok(cached);
  }
  validate_public_url(&initial).await?;

  let preview = if let Some(found) = try_oembed(&state.client, &initial).await {
    found
  } else {
    fetch_html_preview(&state.client, initial).await?
  };

  let mut guard = state.cache.lock().await;
  if guard.len() >= MAX_CACHE_ENTRIES {
    guard.clear();
  }
  guard.insert(key, preview.clone());
  Ok(preview)
}

async fn fetch_html_preview(client: &reqwest::Client, mut current: Url) -> Result<LinkPreview, String> {
  let mut response = None;
  for _ in 0..=MAX_REDIRECTS {
    let res = client
      .get(current.clone())
      .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
      .header("Accept-Language", "en-US,en;q=0.9")
      .send()
      .await
      .map_err(|e| e.to_string())?;
    if res.status().is_redirection() {
      let Some(loc) = res.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()) else {
        return Err("Redirect missing target.".to_string());
      };
      current = current.join(loc).map_err(|_| "Invalid redirect URL.".to_string())?;
      validate_public_url(&current).await?;
      continue;
    }
    response = Some(res);
    break;
  }

  let Some(mut res) = response else {
    return Err("Too many redirects.".to_string());
  };
  if !res.status().is_success() {
    return Err(format!("HTTP {}", res.status().as_u16()));
  }

  let content_type = res
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_ascii_lowercase();
  if !content_type.contains("text/html") && !content_type.contains("application/xhtml") {
    return Ok(LinkPreview {
      url: current.to_string(),
      title: None,
      description: None,
      site_name: None,
      image: None,
      icon: None,
    });
  }

  let mut bytes = Vec::with_capacity(32_768);
  while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
    let remaining = MAX_HTML_BYTES.saturating_sub(bytes.len());
    let take = chunk.len().min(remaining);
    bytes.extend_from_slice(&chunk[..take]);
    if bytes.len() >= MAX_HTML_BYTES || contains_head_close(&bytes) {
      break;
    }
  }

  let html = String::from_utf8_lossy(&bytes);
  Ok(parse_html_metadata(&current, &html))
}

fn contains_head_close(bytes: &[u8]) -> bool {
  bytes
    .windows(7)
    .any(|w| w.eq_ignore_ascii_case(b"</head>"))
}

fn parse_html_metadata(base: &Url, html: &str) -> LinkPreview {
  let mut meta: HashMap<String, String> = HashMap::new();
  let mut icon: Option<String> = None;
  let mut touch_icon: Option<String> = None;
  let mut title_tag: Option<String> = None;

  let mut cursor = 0;
  let bytes = html.as_bytes();
  while let Some(rel_open) = html[cursor..].find('<') {
    let open = cursor + rel_open;
    if html[open..].starts_with("<!--") {
      if let Some(end) = html[open + 4..].find("-->") {
        cursor = open + 4 + end + 3;
        continue;
      }
      break;
    }
    let Some(rel_close) = find_tag_end(&html[open + 1..]) else {
      break;
    };
    let close = open + 1 + rel_close;
    let raw_tag = &html[open + 1..close];
    cursor = close + 1;

    let trimmed = raw_tag.trim();
    if trimmed.is_empty() || trimmed.starts_with('/') || trimmed.starts_with('!') || trimmed.starts_with('?') {
      if trimmed.eq_ignore_ascii_case("/head") {
        break;
      }
      continue;
    }

    let name_end = trimmed
      .find(|c: char| c.is_ascii_whitespace() || c == '/')
      .unwrap_or(trimmed.len());
    let tag_name = trimmed[..name_end].to_ascii_lowercase();
    let attr_str = &trimmed[name_end..];

    if tag_name == "title" && title_tag.is_none() {
      if let Some(end_title) = find_case_insensitive(&html[cursor..], "</title>") {
        title_tag = clean_text(Some(&html[cursor..cursor + end_title]));
        cursor += end_title + 8;
      }
    } else if tag_name == "meta" {
      let attrs = parse_attributes(attr_str);
      let key = attrs
        .get("property")
        .or_else(|| attrs.get("name"))
        .map(|s| s.to_ascii_lowercase());
      let content = attrs.get("content").and_then(|v| clean_text(Some(v)));
      if let (Some(k), Some(v)) = (key, content) {
        meta.entry(k).or_insert(v);
      }
    } else if tag_name == "link" {
      let attrs = parse_attributes(attr_str);
      let rel = attrs.get("rel").map(|s| s.to_ascii_lowercase()).unwrap_or_default();
      if let Some(href) = attrs.get("href") {
        if rel.contains("apple-touch-icon") && touch_icon.is_none() {
          touch_icon = Some(href.clone());
        } else if rel.split_ascii_whitespace().any(|t| t == "icon") && icon.is_none() {
          icon = Some(href.clone());
        }
      }
    }

    if cursor >= bytes.len() {
      break;
    }
  }

  let title = meta
    .remove("og:title")
    .or_else(|| meta.remove("twitter:title"))
    .or(title_tag);
  let description = meta
    .remove("og:description")
    .or_else(|| meta.remove("twitter:description"))
    .or_else(|| meta.remove("description"));
  let site_name = meta
    .remove("og:site_name")
    .or_else(|| meta.remove("application-name"));
  let raw_image = meta
    .remove("og:image:secure_url")
    .or_else(|| meta.remove("og:image"))
    .or_else(|| meta.remove("og:image:url"))
    .or_else(|| meta.remove("twitter:image"))
    .or_else(|| meta.remove("twitter:image:src"));

  LinkPreview {
    url: base.to_string(),
    title,
    description,
    site_name,
    image: sanitize_asset_url(base, raw_image),
    icon: sanitize_asset_url(base, touch_icon.or(icon)),
  }
}

fn find_tag_end(s: &str) -> Option<usize> {
  let mut quote: Option<u8> = None;
  for (i, b) in s.bytes().enumerate() {
    match quote {
      Some(q) if b == q => quote = None,
      Some(_) => {}
      None if b == b'"' || b == b'\'' => quote = Some(b),
      None if b == b'>' => return Some(i),
      _ => {}
    }
  }
  None
}

fn find_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
  let n = needle.as_bytes();
  haystack
    .as_bytes()
    .windows(n.len())
    .position(|w| w.eq_ignore_ascii_case(n))
}

fn parse_attributes(input: &str) -> HashMap<String, String> {
  let mut map = HashMap::new();
  let bytes = input.as_bytes();
  let len = bytes.len();
  let mut i = 0;

  while i < len {
    while i < len && (bytes[i].is_ascii_whitespace() || bytes[i] == b'/') {
      i += 1;
    }
    let key_start = i;
    while i < len && !bytes[i].is_ascii_whitespace() && bytes[i] != b'=' && bytes[i] != b'/' {
      i += 1;
    }
    if i == key_start {
      break;
    }
    let key = input[key_start..i].to_ascii_lowercase();
    while i < len && bytes[i].is_ascii_whitespace() {
      i += 1;
    }
    if i >= len || bytes[i] != b'=' {
      continue;
    }
    i += 1;
    while i < len && bytes[i].is_ascii_whitespace() {
      i += 1;
    }
    if i >= len {
      break;
    }
    let value = if bytes[i] == b'"' || bytes[i] == b'\'' {
      let q = bytes[i];
      i += 1;
      let val_start = i;
      while i < len && bytes[i] != q {
        i += 1;
      }
      let slice = &input[val_start..i];
      if i < len {
        i += 1;
      }
      slice
    } else {
      let val_start = i;
      while i < len && !bytes[i].is_ascii_whitespace() && bytes[i] != b'>' {
        i += 1;
      }
      &input[val_start..i]
    };
    map.entry(key).or_insert_with(|| decode_entities(value));
  }

  map
}

fn extract_blockquote_paragraph(html: &str) -> Option<String> {
  let start = find_case_insensitive(html, "<p")?;
  let after_open = html[start..].find('>')? + start + 1;
  let end = find_case_insensitive(&html[after_open..], "</p>")? + after_open;
  let inner = strip_tags(&html[after_open..end]);
  clean_text(Some(&inner))
}

fn strip_tags(html: &str) -> String {
  let mut out = String::with_capacity(html.len());
  let mut in_tag = false;
  let mut tag_buf = String::new();
  for ch in html.chars() {
    if ch == '<' {
      in_tag = true;
      tag_buf.clear();
    } else if ch == '>' && in_tag {
      in_tag = false;
      let t = tag_buf.trim().to_ascii_lowercase();
      if t == "br" || t == "br/" || t == "br /" {
        out.push(' ');
      }
    } else if in_tag {
      tag_buf.push(ch);
    } else {
      out.push(ch);
    }
  }
  out
}

fn clean_text(raw: Option<&str>) -> Option<String> {
  let decoded = decode_entities(raw?);
  let collapsed = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
  if collapsed.is_empty() {
    None
  } else {
    Some(collapsed)
  }
}

fn decode_entities(input: &str) -> String {
  if !input.contains('&') {
    return input.to_string();
  }
  let mut out = String::with_capacity(input.len());
  let mut rest = input;
  while let Some(amp) = rest.find('&') {
    out.push_str(&rest[..amp]);
    let after = &rest[amp + 1..];
    if let Some(semi) = after.bytes().take(12).position(|b| b == b';') {
      let entity = &after[..semi];
      if let Some(decoded) = resolve_entity(entity) {
        out.push_str(&decoded);
        rest = &after[semi + 1..];
        continue;
      }
    }
    out.push('&');
    rest = after;
  }
  out.push_str(rest);
  out
}

fn resolve_entity(entity: &str) -> Option<String> {
  if let Some(hex) = entity.strip_prefix("#x").or_else(|| entity.strip_prefix("#X")) {
    let code = u32::from_str_radix(hex, 16).ok()?;
    return char::from_u32(code).map(|c| c.to_string());
  }
  if let Some(dec) = entity.strip_prefix('#') {
    let code = dec.parse::<u32>().ok()?;
    return char::from_u32(code).map(|c| c.to_string());
  }
  let mapped = match entity {
    "amp" => "&",
    "lt" => "<",
    "gt" => ">",
    "quot" => "\"",
    "apos" => "'",
    "nbsp" => " ",
    "middot" => "·",
    "bull" => "•",
    "hellip" => "...",
    "rsquo" | "lsquo" => "'",
    "rdquo" | "ldquo" => "\"",
    "ndash" | "mdash" => "-",
    "copy" => "(c)",
    _ => return None,
  };
  Some(mapped.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn filters_private_and_local_ips() {
    assert!(!is_public_ip("127.0.0.1".parse().unwrap()));
    assert!(!is_public_ip("10.0.0.5".parse().unwrap()));
    assert!(!is_public_ip("172.16.12.1".parse().unwrap()));
    assert!(!is_public_ip("192.168.1.20".parse().unwrap()));
    assert!(!is_public_ip("169.254.169.254".parse().unwrap()));
    assert!(!is_public_ip("100.64.0.10".parse().unwrap()));
    assert!(!is_public_ip("::1".parse().unwrap()));
    assert!(!is_public_ip("::ffff:127.0.0.1".parse().unwrap()));
    assert!(!is_public_ip("fd00::1".parse().unwrap()));
    assert!(!is_public_ip("fe80::1".parse().unwrap()));
    assert!(is_public_ip("1.1.1.1".parse().unwrap()));
    assert!(is_public_ip("2606:4700:4700::1111".parse().unwrap()));
  }

  #[test]
  fn parses_open_graph_and_relative_assets() {
    let base = Url::parse("https://example.com/posts/hello").unwrap();
    let html = r#"
      <!doctype html>
      <html>
        <head>
          <title>Fallback Title</title>
          <meta content="Rich &amp; Crisp &#x1F525;" property="og:title">
          <meta name='og:description' content='Line one   line two'>
          <meta property="og:site_name" content="Example">
          <meta property="og:image" content="/assets/hero.jpg">
          <link rel="apple-touch-icon" href="/icon.png">
        </head>
        <body>Ignored</body>
      </html>
    "#;
    let preview = parse_html_metadata(&base, html);
    assert_eq!(preview.title.as_deref(), Some("Rich & Crisp 🔥"));
    assert_eq!(preview.description.as_deref(), Some("Line one line two"));
    assert_eq!(preview.site_name.as_deref(), Some("Example"));
    assert_eq!(preview.image.as_deref(), Some("https://example.com/assets/hero.jpg"));
    assert_eq!(preview.icon.as_deref(), Some("https://example.com/icon.png"));
  }
}

