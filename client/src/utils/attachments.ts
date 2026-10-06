import type { Attachment, Message } from "../api/types";

export function attachmentLabel(attachment: Attachment): string {
  if (attachment.mimeType.startsWith("image/")) return "Image";
  if (attachment.mimeType.startsWith("video/")) return "Video";
  if (attachment.mimeType.startsWith("audio/")) return "Audio Message";
  return attachment.fileName;
}

export function attachmentPreview(attachment: Attachment): string {
  return attachment.mimeType.startsWith("audio/") ? "Sent an audio message" : attachmentLabel(attachment);
}

export function unsentNote(message: Message): string {
  if (message.isFromMe) return "You unsent a message";
  const name = message.sender?.displayName ?? message.sender?.handle;
  return name ? `${name} unsent a message` : "A message was unsent";
}

export function messagePreview(message: Message): string {
  if (message.unsent) return unsentNote(message);
  if (message.text) return message.text;
  return message.attachments[0] ? attachmentPreview(message.attachments[0]) : "";
}
