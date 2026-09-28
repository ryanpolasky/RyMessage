import { useEffect, useRef } from "react";
import type { RyMessageBridge } from "./api/bridge";
import type { Conversation, Message } from "./api/types";
import { isDesktop, onOpenConversation, sendOverlayNotice } from "./desktop";

function fallbackConversation(message: Message): Conversation | null {
  if (!message.sender) return null;
  return {
    id: message.conversationId,
    displayName: null,
    participants: [message.sender],
    isGroup: false,
    lastMessage: message,
    unreadCount: 1,
    service: message.service,
    pinned: false,
  };
}

export function useOverlayNotifications(
  bridge: RyMessageBridge,
  conversations: Conversation[],
  selectedId: string | null,
  onOpen: (conversationId: string) => void
) {
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    if (!isDesktop) return;
    const offEvents = bridge.subscribe((event) => {
      if (event.type !== "messageCreated" || event.message.isFromMe) return;
      const message = event.message;
      if (document.hasFocus() && selectedIdRef.current === message.conversationId) return;
      const conversation =
        conversationsRef.current.find((c) => c.id === message.conversationId) ??
        fallbackConversation(message);
      if (!conversation) return;
      sendOverlayNotice({ conversation, message }).catch((e) =>
        console.warn("Failed to show overlay notice", e)
      );
    });
    const offOpen = onOpenConversation(onOpen);
    return () => {
      offEvents();
      offOpen();
    };
  }, [bridge, onOpen]);
}
