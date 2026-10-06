import type { Attachment } from "../api/types";

export function attachmentLabel(attachment: Attachment): string {
  if (attachment.mimeType.startsWith("image/")) return "Image";
  if (attachment.mimeType.startsWith("video/")) return "Video";
  if (attachment.mimeType.startsWith("audio/")) return "Audio Message";
  return attachment.fileName;
}

export function attachmentPreview(attachment: Attachment): string {
  return attachment.mimeType.startsWith("audio/") ? "Sent an audio message" : attachmentLabel(attachment);
}
