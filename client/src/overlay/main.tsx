import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MockBridge } from "../api/mockBridge";
import type { Conversation } from "../api/types";
import type { OverlayNotice } from "../desktop";
import {
  fitOverlayWindow,
  isDesktop,
  notifyOverlayDismissed,
  onOverlayNotice,
  requestOpenConversation,
} from "../desktop";
import { useSettings } from "../settings";
import { OVERLAY_WIDTH, Overlay } from "./Overlay";
import "../styles.css";
import "./overlay.css";

function previewNotices(handler: (notice: OverlayNotice) => void): () => void {
  const bridge = new MockBridge([2500, 4500]);
  let conversations: Conversation[] = [];
  bridge.getConversations().then((list) => (conversations = list));
  const off = bridge.subscribe((event) => {
    if (event.type === "conversationUpdated") {
      conversations = conversations.map((c) => (c.id === event.conversation.id ? event.conversation : c));
      return;
    }
    if (event.type !== "messageCreated" || event.message.isFromMe) return;
    const conversation = conversations.find((c) => c.id === event.message.conversationId);
    if (conversation) handler({ conversation, message: event.message });
  });
  return () => {
    off();
    bridge.close();
  };
}

function OverlayApp() {
  const [settings] = useSettings();
  const ttlMs = settings.dismissAfterSeconds === 0 ? null : settings.dismissAfterSeconds * 1000;
  if (!isDesktop) {
    return (
      <Overlay
        subscribe={previewNotices}
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
