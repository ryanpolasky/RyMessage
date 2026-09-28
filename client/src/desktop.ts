import { isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import type { Conversation, Message } from "./api/types";

export interface OverlayNotice {
  conversation: Conversation;
  message: Message;
}

export const isDesktop = isTauri();

const NOTICE_EVENT = "overlay-notice";
const OPEN_EVENT = "overlay-open";

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
