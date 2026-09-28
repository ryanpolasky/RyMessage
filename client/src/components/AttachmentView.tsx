import { useEffect, useState } from "react";
import type { Attachment } from "../api/types";

interface AttachmentViewProps {
  attachment: Attachment;
  loadAttachment: (attachment: Attachment) => Promise<Blob>;
}

type Kind = "image" | "video" | "audio" | "file";

function kindOf(attachment: Attachment): Kind {
  const [type] = attachment.mimeType.split("/");
  return type === "image" || type === "video" || type === "audio" ? type : "file";
}

function isLocal(attachment: Attachment): boolean {
  return attachment.url.startsWith("blob:");
}

export function AttachmentView({ attachment, loadAttachment }: AttachmentViewProps) {
  const kind = kindOf(attachment);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (kind === "file") return;
    setFailed(false);
    if (isLocal(attachment)) {
      setSrc(attachment.url);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    loadAttachment(attachment).then(
      (blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      },
      () => !cancelled && setFailed(true)
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.url, kind, loadAttachment]);

  async function download() {
    setFailed(false);
    try {
      const url = isLocal(attachment)
        ? attachment.url
        : URL.createObjectURL(await loadAttachment(attachment));
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName;
      link.click();
      if (!isLocal(attachment)) setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setFailed(true);
    }
  }

  if (kind === "file" || failed) {
    return (
      <button className={`bubble-file ${failed ? "failed" : ""}`} onClick={download}>
        {failed ? `${attachment.fileName} (unavailable)` : attachment.fileName}
      </button>
    );
  }
  if (!src) {
    if (kind === "audio") return <div className="bubble-audio-placeholder" />;
    const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : kind === "video" ? 9 / 16 : 4 / 3;
    return <div className={`bubble-image-placeholder ${kind === "video" ? "video" : ""}`} style={{ aspectRatio: ratio }} />;
  }
  if (kind === "video") {
    return (
      <video
        className="bubble-video"
        src={src}
        controls
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
      />
    );
  }
  if (kind === "audio") {
    return <audio className="bubble-audio" src={src} controls preload="metadata" onError={() => setFailed(true)} />;
  }
  return <img className="bubble-image" src={src} alt={attachment.fileName} />;
}
