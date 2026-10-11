import { useEffect, useRef } from "react";
import type { RyMessageBridge } from "./api/bridge";
import type { Conversation, Message } from "./api/types";
import { withInlineAvatar } from "./avatars";
import {
  isDesktop,
  isWindowFocused,
  onOpenConversation,
  onOverlayDismissed,
  onWindowFocusChanged,
  requestOverlayClear,
  sendOverlayNotice,
  sendOverlayUpdate,
} from "./desktop";
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
  settings: Settings,
  onOpen: (conversationId: string) => void
) {
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const focusedRef = useRef(false);

  useEffect(() => {
    const offEvents = bridge.subscribe((event) => {
      if (event.type === "messageUpdated" && isDesktop && (event.message.unsent || event.message.editedAt)) {
        sendOverlayUpdate(event.message).catch((e) => console.warn("Failed to update notification", e));
        return;
      }
      if (event.type !== "messageCreated" || event.message.isFromMe) return;
      if (isDesktop ? focusedRef.current : document.hasFocus()) return;
      const message = event.message;
      void playNotificationSound(settingsRef.current.sound);
      if (!isDesktop || !settingsRef.current.overlay) return;
      const conversation =
        conversationsRef.current.find((c) => c.id === message.conversationId) ??
        fallbackConversation(message);
      if (!conversation) return;
      const loadAvatar = (url: string) => bridge.getAvatar(url);
      const timedOut = Symbol("timedOut");
      const avatars = Promise.all([
        message.sender ? withInlineAvatar(message.sender, loadAvatar) : null,
        Promise.all(conversation.participants.map((p) => withInlineAvatar(p, loadAvatar))),
      ]);
      // a stalled avatar fetch must never block the notification itself
      Promise.race([avatars, new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), 1500))])
        .then((loaded) => {
          const [sender, participants] =
            loaded === timedOut ? [message.sender, conversation.participants] : loaded;
          const notice = { conversation: { ...conversation, participants }, message: { ...message, sender } };
          return sendOverlayNotice(notice);
        })
        .catch((e) => console.warn("Failed to show overlay notice", e));
    });
    const offOpen = isDesktop
      ? onOpenConversation((id) => {
          if (conversationsRef.current.some((c) => c.id === id)) onOpen(id);
        })
      : () => {};
    const offDismissed = isDesktop ? onOverlayDismissed(stopNotificationSound) : () => {};
    // document.hasFocus() stays true on a window that was never shown, so track the real window focus
    const onFocused = () => {
      stopNotificationSound();
      requestOverlayClear().catch((e) => console.warn("Failed to clear notifications", e));
    };
    const offFocus = isDesktop
      ? (isWindowFocused().then((f) => (focusedRef.current = f)),
        onWindowFocusChanged((focused) => {
          focusedRef.current = focused;
          if (focused) onFocused();
        }))
      : () => {};
    const onDomFocus = () => {
      stopNotificationSound();
    };
    if (!isDesktop) window.addEventListener("focus", onDomFocus);
    return () => {
      offEvents();
      offOpen();
      offDismissed();
      offFocus();
      if (!isDesktop) window.removeEventListener("focus", onDomFocus);
    };
  }, [bridge, onOpen]);
}
