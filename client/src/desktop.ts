import { isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Conversation, Message } from "./api/types";

export interface OverlayNotice {
  conversation: Conversation;
  message: Message;
}

export const isDesktop = isTauri();

const NOTICE_EVENT = "overlay-notice";
const OPEN_EVENT = "overlay-open";
const DISMISSED_EVENT = "overlay-dismissed";
const CLEAR_EVENT = "overlay-clear";

function unlistenLater(pending: Promise<() => void>): () => void {
  return () => {
    pending.then((unlisten) => unlisten());
  };
}

export function sendOverlayNotice(notice: OverlayNotice): Promise<void> {
  return emitTo("overlay", NOTICE_EVENT, notice);
}

export function onOverlayNotice(handler: (notice: OverlayNotice) => void): () => void {
  return unlistenLater(listen<OverlayNotice>(NOTICE_EVENT, (e) => handler(e.payload)));
}

export function notifyOverlayDismissed(): Promise<void> {
  return emitTo("main", DISMISSED_EVENT);
}

export function onOverlayDismissed(handler: () => void): () => void {
  return unlistenLater(listen(DISMISSED_EVENT, handler));
}

export function requestOverlayClear(): Promise<void> {
  return emitTo("overlay", CLEAR_EVENT);
}

export function onOverlayClear(handler: () => void): () => void {
  return unlistenLater(listen(CLEAR_EVENT, handler));
}

export function requestOpenConversation(conversationId: string): Promise<void> {
  return emitTo("main", OPEN_EVENT, conversationId);
}

export function onOpenConversation(handler: (conversationId: string) => void): () => void {
  return unlistenLater(
    listen<string>(OPEN_EVENT, async (e) => {
      const window = getCurrentWindow();
      await window.show();
      await window.unminimize();
      await window.setFocus();
      handler(e.payload);
    })
  );
}

export async function fitOverlayWindow(width: number, height: number): Promise<void> {
  const window = getCurrentWindow();
  if (height === 0) return window.hide();
  await window.setSize(new LogicalSize(width, height));
  await window.show();
}

// the overlay can never take focus, and the web clipboard API refuses unfocused pages
export function copyText(text: string): Promise<void> {
  return isDesktop ? writeText(text) : navigator.clipboard.writeText(text);
}

export function hideOnMinimize(): () => void {
  const window = getCurrentWindow();
  return unlistenLater(
    window.onResized(async () => {
      if (await window.isMinimized()) await window.hide();
    })
  );
}

export function getLaunchAtLogin(): Promise<boolean> {
  return isEnabled();
}

export function setLaunchAtLogin(enabled: boolean): Promise<void> {
  return enabled ? enable() : disable();
}

export function showTestNotice(): Promise<void> {
  const sender = { id: "rymessage-test", displayName: "RyMessage", handle: "RyMessage", avatarUrl: null };
  const now = new Date().toISOString();
  return sendOverlayNotice({
    conversation: {
      id: "rymessage-test",
      displayName: "RyMessage",
      participants: [sender],
      isGroup: false,
      lastMessage: null,
      unreadCount: 0,
      service: "iMessage",
      pinned: false,
    },
    message: {
      id: `rymessage-test-${now}`,
      conversationId: "rymessage-test",
      sender,
      isFromMe: false,
      text: "This is what new texts look like. Swipe left to dismiss.",
      attachments: [],
      sentAt: now,
      deliveredAt: null,
      readAt: null,
      service: "iMessage",
      status: "sent",
      clientId: null,
      reactions: [],
      replyTo: null,
    },
  });
}
