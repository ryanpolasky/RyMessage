import { invoke, isTauri } from "@tauri-apps/api/core";
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
const UPDATE_EVENT = "overlay-update";
const READY_EVENT = "overlay-ready";
const READY_TIMEOUT_MS = 5000;

function unlistenLater(pending: Promise<() => void>): () => void {
  return () => {
    pending.then((unlisten) => unlisten());
  };
}

let overlayReady: Promise<void> | null = null;

function readyOverlay(): Promise<void> {
  overlayReady ??= (async () => {
    let signal = () => {};
    const ready = new Promise<void>((resolve) => {
      signal = resolve;
      setTimeout(resolve, READY_TIMEOUT_MS);
    });
    const unlisten = await listen(READY_EVENT, () => signal());
    try {
      if (await invoke<boolean>("ensure_overlay")) await ready;
    } finally {
      unlisten();
    }
  })().catch((e) => {
    overlayReady = null;
    throw e;
  });
  return overlayReady;
}

const overlayListeners: Promise<unknown>[] = [];

function overlayListen<T>(event: string, handler: (payload: T) => void): () => void {
  const pending = listen<T>(event, (e) => handler(e.payload));
  overlayListeners.push(pending);
  return unlistenLater(pending);
}

export async function announceOverlayReady(): Promise<void> {
  await Promise.all(overlayListeners);
  await emitTo("main", READY_EVENT);
}

export async function sendOverlayNotice(notice: OverlayNotice): Promise<void> {
  await readyOverlay();
  await emitTo("overlay", NOTICE_EVENT, notice);
}

export function onOverlayNotice(handler: (notice: OverlayNotice) => void): () => void {
  return overlayListen(NOTICE_EVENT, handler);
}

export function notifyOverlayDismissed(): Promise<void> {
  return emitTo("main", DISMISSED_EVENT);
}

export function onOverlayDismissed(handler: () => void): () => void {
  return unlistenLater(listen(DISMISSED_EVENT, handler));
}

export async function requestOverlayClear(): Promise<void> {
  if (overlayReady) await emitTo("overlay", CLEAR_EVENT);
}

export function isWindowFocused(): Promise<boolean> {
  return isDesktop ? getCurrentWindow().isFocused() : Promise.resolve(document.hasFocus());
}

export function onWindowFocusChanged(handler: (focused: boolean) => void): () => void {
  return unlistenLater(getCurrentWindow().onFocusChanged((event) => handler(event.payload)));
}

export function onOverlayClear(handler: () => void): () => void {
  return overlayListen(CLEAR_EVENT, handler);
}

export async function sendOverlayUpdate(message: Message): Promise<void> {
  if (overlayReady) await emitTo("overlay", UPDATE_EVENT, message);
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
