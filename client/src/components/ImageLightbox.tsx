import { useEffect, useRef, useState } from "react";
import type { Attachment } from "../api/types";

interface ImageLightboxProps {
  images: Attachment[];
  current: Attachment;
  loadAttachment: (attachment: Attachment) => Promise<Blob>;
  onSelect: (attachment: Attachment) => void;
  onClose: () => void;
}

export function ImageLightbox({
  images,
  current,
  loadAttachment,
  onSelect,
  onClose,
}: ImageLightboxProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(
    null
  );
  const suppressClickRef = useRef(false);

  const index = images.findIndex((img) => img.id === current.id);
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < images.length - 1;

  useEffect(() => {
    setZoomed(false);
    setOffset({ x: 0, y: 0 });
    setFailed(false);

    if (current.url.startsWith("blob:")) {
      setSrc(current.url);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    loadAttachment(current).then(
      (blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      },
      () => {
        if (!cancelled) setFailed(true);
      }
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [current, loadAttachment]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowLeft" && hasPrev) {
        e.preventDefault();
        e.stopPropagation();
        onSelect(images[index - 1]);
      } else if (e.key === "ArrowRight" && hasNext) {
        e.preventDefault();
        e.stopPropagation();
        onSelect(images[index + 1]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onSelect, images, index, hasPrev, hasNext]);

  function toggleZoom() {
    setZoomed((prev) => {
      if (prev) setOffset({ x: 0, y: 0 });
      return !prev;
    });
  }

  async function download() {
    try {
      const url = current.url.startsWith("blob:")
        ? current.url
        : src ?? URL.createObjectURL(await loadAttachment(current));
      const revoke = !current.url.startsWith("blob:") && !src;
      const link = document.createElement("a");
      link.href = url;
      link.download = current.fileName;
      link.click();
      if (revoke) setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div
      className="lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={current.fileName}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className="lightbox-toolbar" onMouseDown={(e) => e.stopPropagation()}>
        <div className="lightbox-meta">
          <span className="lightbox-title">{current.fileName}</span>
          {images.length > 1 && index >= 0 && (
            <span className="lightbox-count">
              {index + 1} of {images.length}
            </span>
          )}
        </div>
        <div className="lightbox-actions">
          <button
            className="lightbox-btn"
            onClick={toggleZoom}
            disabled={!src}
            title={zoomed ? "Zoom Out" : "Zoom In"}
          >
            {zoomed ? (
              <svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7">
                <circle cx="7.8" cy="7.8" r="5.3" />
                <path d="M5.4 7.8h4.8M11.7 11.7L15.5 15.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7">
                <circle cx="7.8" cy="7.8" r="5.3" />
                <path d="M7.8 5.4v4.8M5.4 7.8h4.8M11.7 11.7L15.5 15.5" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <button className="lightbox-btn" onClick={download} title="Save Image">
            <svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M9 3v8.5m0 0L5.5 8M9 11.5L12.5 8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3.5 13v1.2A1.3 1.3 0 0 0 4.8 15.5h8.4a1.3 1.3 0 0 0 1.3-1.3V13" strokeLinecap="round" />
            </svg>
          </button>
          <button className="lightbox-btn" onClick={onClose} title="Close">
            <svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4.5 4.5l9 9m0-9l-9 9" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      {hasPrev && (
        <button
          className="lightbox-nav prev"
          onClick={() => onSelect(images[index - 1])}
          title="Previous Image"
        >
          <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12.5 4.5L7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      <div
        className="lightbox-stage"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {failed ? (
          <div className="lightbox-status">Couldn't load image.</div>
        ) : !src ? (
          <div className="loading-spinner lightbox-spinner" />
        ) : (
          <img
            className={`lightbox-image ${zoomed ? "zoomed" : ""}`}
            src={src}
            alt={current.fileName}
            draggable={false}
            style={
              zoomed
                ? { transform: `translate(${offset.x}px, ${offset.y}px) scale(2)` }
                : undefined
            }
            onPointerDown={(e) => {
              if (!zoomed || e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                origX: offset.x,
                origY: offset.y,
                moved: false,
              };
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d) return;
              const dx = e.clientX - d.startX;
              const dy = e.clientY - d.startY;
              if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
              setOffset({ x: d.origX + dx, y: d.origY + dy });
            }}
            onPointerUp={() => {
              if (dragRef.current?.moved) suppressClickRef.current = true;
              dragRef.current = null;
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              toggleZoom();
            }}
          />
        )}
      </div>

      {hasNext && (
        <button
          className="lightbox-nav next"
          onClick={() => onSelect(images[index + 1])}
          title="Next Image"
        >
          <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7.5 4.5L13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
