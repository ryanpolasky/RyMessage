import { useEffect, useState } from "react";
import type { LinkPreview } from "../api/types";
import { openExternal } from "../desktop";
import { displayDomain, fallbackLinkTitle, isVideoLink } from "../utils/links";

interface LinkCardProps {
  url: string;
  preview: LinkPreview | null | undefined;
}

export function LinkCard({ url, preview }: LinkCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
    setIconFailed(false);
  }, [preview?.image, preview?.icon]);

  const targetUrl = preview?.url || url;
  const domain = displayDomain(targetUrl);
  const hasImage = Boolean(preview?.image && !imageFailed);
  const hasIcon = Boolean(preview?.icon && !iconFailed);
  const title = preview?.title || fallbackLinkTitle(targetUrl);
  const subtitle = preview?.siteName && preview.siteName.toLowerCase() !== domain.toLowerCase()
    ? `${preview.siteName} · ${domain}`
    : domain;

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    openExternal(targetUrl);
  }

  if (hasImage) {
    return (
      <a
        className="link-card with-image"
        href={targetUrl}
        onClick={handleClick}
        draggable={false}
      >
        <div className="link-card-media">
          <img
            className="link-card-image"
            src={preview!.image!}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            draggable={false}
            onError={() => setImageFailed(true)}
          />
          {isVideoLink(targetUrl) && (
            <div className="link-card-play" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="16" height="16">
                <path d="M5.2 3.4v9.2L12.8 8z" fill="currentColor" />
              </svg>
            </div>
          )}
        </div>
        <div className="link-card-body">
          <div className="link-card-title">{title}</div>
          <div className="link-card-domain">{subtitle}</div>
        </div>
      </a>
    );
  }

  return (
    <a
      className={`link-card compact ${preview === undefined ? "loading" : ""}`}
      href={targetUrl}
      onClick={handleClick}
      draggable={false}
    >
      <div className="link-card-body">
        <div className="link-card-title">{title}</div>
        {preview?.description && (
          <div className="link-card-desc">{preview.description}</div>
        )}
        <div className="link-card-domain">{subtitle}</div>
      </div>
      <div className="link-card-icon-wrap" aria-hidden="true">
        {hasIcon ? (
          <img
            className="link-card-icon"
            src={preview!.icon!}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            draggable={false}
            onError={() => setIconFailed(true)}
          />
        ) : (
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="10" cy="10" r="7.5" />
            <ellipse cx="10" cy="10" rx="3.3" ry="7.5" />
            <path d="M2.8 10h14.4" />
          </svg>
        )}
      </div>
    </a>
  );
}
