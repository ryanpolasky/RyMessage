import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MockBridge } from "../api/mockBridge";
import type { Conversation, Message } from "../api/types";
import type { OverlayNotice } from "../desktop";
import {
  fitOverlayWindow,
  isDesktop,
  notifyOverlayDismissed,
  onOverlayClear,
  onOverlayNotice,
  onOverlayUpdate,
  requestOpenConversation,
} from "../desktop";
import { useSettings } from "../settings";
import { OVERLAY_WIDTH, Overlay } from "./Overlay";
import "../styles.css";
import "./overlay.css";

let previewBridge: MockBridge | null = null;

function previewNotices(handler: (notice: OverlayNotice) => void): () => void {
  previewBridge ??= new MockBridge([2500, 4500]);
  let conversations: Conversation[] = [];
  previewBridge.getConversations().then((list) => (conversations = list));
  return previewBridge.subscribe((event) => {
    if (event.type === "conversationUpdated") {
      conversations = conversations.map((c) => (c.id === event.conversation.id ? event.conversation : c));
      return;
    }
    if (event.type !== "messageCreated" || event.message.isFromMe) return;
    const conversation = conversations.find((c) => c.id === event.message.conversationId);
    if (conversation) handler({ conversation, message: event.message });
  });
}

function previewUpdates(handler: (message: Message) => void): () => void {
  previewBridge ??= new MockBridge([2500, 4500]);
  return previewBridge.subscribe((event) => {
    if (event.type === "messageUpdated" && (event.message.unsent || event.message.editedAt)) handler(event.message);
  });
}

// lets the browser preview exercise the same clear path the desktop app uses
function previewClear(handler: () => void): () => void {
  const listener = () => handler();
  window.addEventListener("rym-preview-clear", listener);
  return () => window.removeEventListener("rym-preview-clear", listener);
}

function OverlayApp() {
  const [settings] = useSettings();
  const ttlMs = settings.dismissAfterSeconds === 0 ? null : settings.dismissAfterSeconds * 1000;
  if (!isDesktop) {
    return (
      <Overlay
        subscribe={previewNotices}
        subscribeClear={previewClear}
        subscribeUpdate={previewUpdates}
        ttlMs={ttlMs}
        onOpen={() => {}}
        onUserDismiss={() => {}}
        onResize={() => {}}
      />
    );
  }
  return (
    <Overlay
      subscribe={onOverlayNotice}
      subscribeClear={onOverlayClear}
      subscribeUpdate={onOverlayUpdate}
      ttlMs={ttlMs}
      onOpen={(id) => {
        requestOpenConversation(id).catch((e) => console.warn("Failed to open conversation", e));
      }}
      onUserDismiss={() => {
        notifyOverlayDismissed().catch((e) => console.warn("Failed to stop notification sound", e));
      }}
      onResize={(height) => {
        fitOverlayWindow(OVERLAY_WIDTH, height).catch((e) => console.warn("Failed to resize overlay", e));
      }}
    />
  );
}

document.documentElement.classList.add(isDesktop ? "overlay-desktop" : "overlay-preview");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>
);
