export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; url: string };

const BARE_TLDS =
  "com|org|net|edu|gov|mil|io|ai|app|dev|gg|tv|xyz|info|co|uk|ca|de|fr|au|jp";
const SHORTENER_HOSTS =
  "youtu\\.be|bit\\.ly|t\\.co|goo\\.gl|amzn\\.to|redd\\.it|linktr\\.ee|spoti\\.fi|paypal\\.me|t\\.me";

const CANDIDATE_RE = new RegExp(
  `https?:\\/\\/[^\\s<>]+|www\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\\d{2,5})?(?:\\/[^\\s<>]*)?|(?:${SHORTENER_HOSTS})\\/[^\\s<>]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${BARE_TLDS})(?::\\d{2,5})?(?:\\/[^\\s<>]*)?`,
  "gi"
);

const BOUNDARY_CHAR_RE = /[a-zA-Z0-9@/_.-]/;
const TRAILING_PUNCT_RE = /[.,!?;:'"\u2026]$/;

function countChar(str: string, target: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === target) count += 1;
  }
  return count;
}

function trimTrailingPunctuation(raw: string): string {
  let trimmed = raw;
  while (trimmed.length > 0) {
    if (TRAILING_PUNCT_RE.test(trimmed)) {
      trimmed = trimmed.slice(0, -1);
      continue;
    }
    if (trimmed.endsWith(")") && countChar(trimmed, ")") > countChar(trimmed, "(")) {
      trimmed = trimmed.slice(0, -1);
      continue;
    }
    if (trimmed.endsWith("]") && countChar(trimmed, "]") > countChar(trimmed, "[")) {
      trimmed = trimmed.slice(0, -1);
      continue;
    }
    if (trimmed.endsWith("}") && countChar(trimmed, "}") > countChar(trimmed, "{")) {
      trimmed = trimmed.slice(0, -1);
      continue;
    }
    break;
  }
  return trimmed;
}

function normalizeUrl(raw: string): string | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname.includes(".")) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function tokenizeLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  CANDIDATE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CANDIDATE_RE.exec(text)) !== null) {
    const start = match.index;
    const raw = match[0];
    const hasScheme = /^https?:\/\//i.test(raw);
    if (!hasScheme && start > 0 && BOUNDARY_CHAR_RE.test(text[start - 1])) {
      continue;
    }

    const cleaned = trimTrailingPunctuation(raw);
    if (!cleaned) continue;
    const afterIdx = start + cleaned.length;
    const nextChar = text[afterIdx];
    if (!hasScheme && nextChar !== undefined) {
      if (nextChar === "@" || /[a-zA-Z0-9_-]/.test(nextChar)) continue;
      if (nextChar === "." && /[a-zA-Z0-9]/.test(text[afterIdx + 1] ?? "")) continue;
    }
    const normalized = normalizeUrl(cleaned);
    if (!normalized) continue;

    if (start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, start) });
    }
    segments.push({ kind: "link", text: cleaned, url: normalized });
    cursor = start + cleaned.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}

export function extractLinks(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const seg of tokenizeLinks(text)) {
    if (seg.kind === "link") seen.add(seg.url);
  }
  return [...seen];
}

export function soleLink(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const segments = tokenizeLinks(trimmed);
  if (segments.length !== 1 || segments[0].kind !== "link") return null;
  return segments[0].url;
}

export function displayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

export function fallbackLinkTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./i, "");
    const path = decodeURIComponent(parsed.pathname).replace(/\/+$/, "");
    if (!path) return domain;
    const slug = path.split("/").filter(Boolean).pop() ?? "";
    if (!slug) return domain;
    return `${domain}${path.length <= 36 ? path : `/${slug}`}`;
  } catch {
    return url;
  }
}

export function isVideoLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^(www|m)\./i, "").toLowerCase();
    if (host === "youtu.be" || host === "vimeo.com") return true;
    if (host === "youtube.com") {
      const path = new URL(url).pathname;
      return path.startsWith("/watch") || path.startsWith("/shorts/") || path.startsWith("/live/");
    }
    return false;
  } catch {
    return false;
  }
}
