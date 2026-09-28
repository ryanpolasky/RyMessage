import { useEffect, useState } from "react";
import type { Attachment } from "../api/types";

interface AttachmentViewProps {
  attachment: Attachment;
  loadAttachment: (attachment: Attachment) => Promise<Blob>;
}

function isLocal(attachment: Attachment): boolean {
  return attachment.url.startsWith("blob:");
}

export function AttachmentView({ attachment, loadAttachment }: AttachmentViewProps) {
  const isImage = attachment.mimeType.startsWith("image/");
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isImage) return;
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
  }, [attachment.url, isImage, loadAttachment]);

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

  if (!isImage || failed) {
    return (
      <button className={`bubble-file ${failed ? "failed" : ""}`} onClick={download}>
        {failed ? `${attachment.fileName} (unavailable)` : attachment.fileName}
      </button>
    );
  }
  if (!src) {
    const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 4 / 3;
    return <div className="bubble-image-placeholder" style={{ aspectRatio: ratio }} />;
  }
  return <img className="bubble-image" src={src} alt={attachment.fileName} />;
}
