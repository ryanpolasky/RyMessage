import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
const UPDATE_EVENT = "overlay-update";

function unlistenLater(pending: Promise<() => void>): () => void {
  return () => {
    pending.then((unlisten) => unlisten());
  };
}

const overlayListeners = new Set<Promise<unknown>>();
let noticeListener: ((notice: OverlayNotice) => void) | null = null;

function overlayListen<T>(event: string, handler: (payload: T) => void): () => void {
  const pending = listen<T>(event, (e) => handler(e.payload));
  overlayListeners.add(pending);
  return () => {
    overlayListeners.delete(pending);
    pending.then((unlisten) => unlisten());
  };
}

export async function announceOverlayReady(isCancelled: () => boolean): Promise<void> {
  await Promise.all(overlayListeners);
  if (isCancelled()) return;
  const queued = await invoke<OverlayNotice[]>("overlay_ready");
  for (const notice of queued) noticeListener?.(notice);
}

export function sendOverlayNotice(notice: OverlayNotice): Promise<void> {
  return invoke("post_overlay_notice", { notice });
}

export function onOverlayNotice(handler: (notice: OverlayNotice) => void): () => void {
  noticeListener = handler;
  const off = overlayListen(NOTICE_EVENT, handler);
  return () => {
    if (noticeListener === handler) noticeListener = null;
    off();
  };
}

export function notifyOverlayDismissed(): Promise<void> {
  return emitTo("main", DISMISSED_EVENT);
}

export function onOverlayDismissed(handler: () => void): () => void {
  return unlistenLater(listen(DISMISSED_EVENT, handler));
}

export function requestOverlayClear(): Promise<void> {
  return invoke("clear_overlay");
}

export async function isMainWindowActive(): Promise<boolean> {
  if (!isDesktop) return document.visibilityState === "visible" && document.hasFocus();
  const window = getCurrentWindow();
  const [visible, minimized, focused] = await Promise.all([
    window.isVisible(),
    window.isMinimized(),
    window.isFocused(),
  ]);
  return visible && !minimized && focused;
}

export function onWindowFocusChanged(handler: (focused: boolean) => void): () => void {
  return unlistenLater(getCurrentWindow().onFocusChanged((event) => handler(event.payload)));
}

export function onOverlayClear(handler: () => void): () => void {
  return overlayListen(CLEAR_EVENT, handler);
}

export function sendOverlayUpdate(message: Message): Promise<void> {
  return invoke("update_overlay", { message });
}

export function onOverlayUpdate(handler: (message: Message) => void): () => void {
  return overlayListen(UPDATE_EVENT, handler);
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

export function fitOverlayWindow(width: number, height: number): Promise<void> {
  return invoke("sync_overlay_window", { width, height });
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
