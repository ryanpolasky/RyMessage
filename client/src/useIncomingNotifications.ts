import { useEffect, useRef } from "react";
import type { RyMessageBridge } from "./api/bridge";
import type { Conversation, Message } from "./api/types";
import { withInlineAvatar } from "./avatars";
import { isDesktop, onOpenConversation, onOverlayDismissed, sendOverlayNotice } from "./desktop";
import type { Settings } from "./settings";
import { playNotificationSound, stopNotificationSound } from "./sound";

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

export function useIncomingNotifications(
  bridge: RyMessageBridge,
  conversations: Conversation[],
  selectedId: string | null,
  settings: Settings,
  onOpen: (conversationId: string) => void
) {
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const offEvents = bridge.subscribe((event) => {
      if (event.type !== "messageCreated" || event.message.isFromMe) return;
      const message = event.message;
      if (document.hasFocus() && selectedIdRef.current === message.conversationId) return;
      void playNotificationSound(settingsRef.current.sound);
      if (!isDesktop || !settingsRef.current.overlay) return;
      const conversation =
        conversationsRef.current.find((c) => c.id === message.conversationId) ??
        fallbackConversation(message);
      if (!conversation) return;
      const loadAvatar = (url: string) => bridge.getAvatar(url);
      Promise.all([
        message.sender ? withInlineAvatar(message.sender, loadAvatar) : null,
        Promise.all(conversation.participants.map((p) => withInlineAvatar(p, loadAvatar))),
      ])
        .then(([sender, participants]) =>
          sendOverlayNotice({ conversation: { ...conversation, participants }, message: { ...message, sender } })
        )
        .catch((e) => console.warn("Failed to show overlay notice", e));
    });
    const offOpen = isDesktop
      ? onOpenConversation((id) => {
          if (conversationsRef.current.some((c) => c.id === id)) onOpen(id);
        })
      : () => {};
    const offDismissed = isDesktop ? onOverlayDismissed(stopNotificationSound) : () => {};
    return () => {
      offEvents();
      offOpen();
      offDismissed();
    };
  }, [bridge, onOpen]);
}
