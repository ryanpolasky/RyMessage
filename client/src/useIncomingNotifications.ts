import { useCallback, useEffect, useRef } from "react";
import type { RyMessageBridge } from "./api/bridge";
import type { Conversation, Message } from "./api/types";
import { withInlineAvatar } from "./avatars";
import {
  isDesktop,
  isMainWindowActive,
  onOpenConversation,
  onOverlayDismissed,
  onWindowFocusChanged,
  requestOverlayClear,
  sendOverlayNotice,
  sendOverlayUpdate,
} from "./desktop";
import type { Settings } from "./settings";
import { playNotificationSound, stopNotificationSound } from "./sound";

const FRESH_CATCHUP_MS = 120_000;

function fallbackConversation(message: Message): Conversation {
  return {
    id: message.conversationId,
    displayName: message.sender ? null : "New Message",
    participants: message.sender ? [message.sender] : [],
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
  conversationsReady: boolean,
  settings: Settings,
  onOpen: (conversationId: string) => void
) {
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const seenIdsRef = useRef(new Set<string>());
  const lastSeenAtRef = useRef(new Map<string, number>());
  const seededRef = useRef<{ bridge: RyMessageBridge; baselineAt: number } | null>(null);
  if (seededRef.current && seededRef.current.bridge !== bridge) {
    seenIdsRef.current = new Set();
    lastSeenAtRef.current = new Map();
    seededRef.current = null;
  }

  const showOverlay = useCallback(
    (message: Message) => {
      const conversation =
        conversationsRef.current.find((c) => c.id === message.conversationId) ??
        fallbackConversation(message);
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
    },
    [bridge]
  );

  const notify = useCallback(
    async (messages: Message[]) => {
      if (messages.length === 0) return;
      if (await isMainWindowActive().catch(() => false)) return;
      void playNotificationSound(settingsRef.current.sound);
      if (!isDesktop || !settingsRef.current.overlay) return;
      for (const message of messages) showOverlay(message);
    },
    [showOverlay]
  );

  useEffect(() => {
    const offEvents = bridge.subscribe((event) => {
      if (event.type === "messageUpdated" && isDesktop && (event.message.unsent || event.message.editedAt)) {
        sendOverlayUpdate(event.message).catch((e) => console.warn("Failed to update notification", e));
        return;
      }
      if (event.type !== "messageCreated") return;
      const message = event.message;
      const at = Date.parse(message.sentAt) || 0;
      if (at > (lastSeenAtRef.current.get(message.conversationId) ?? 0)) {
        lastSeenAtRef.current.set(message.conversationId, at);
      }
      if (seenIdsRef.current.has(message.id)) return;
      seenIdsRef.current.add(message.id);
      if (message.isFromMe || message.unsent) return;
      void notify([message]);
    });
    const offOpen = isDesktop
      ? onOpenConversation((id) => {
          if (conversationsRef.current.some((c) => c.id === id)) onOpen(id);
        })
      : () => {};
    const offDismissed = isDesktop ? onOverlayDismissed(stopNotificationSound) : () => {};
    const onFocused = () => {
      stopNotificationSound();
      requestOverlayClear().catch((e) => console.warn("Failed to clear notifications", e));
    };
    const offFocus = isDesktop
      ? onWindowFocusChanged((focused) => {
          if (focused) onFocused();
        })
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
  }, [bridge, onOpen, notify]);

  // socket gaps drop live events, so catch up unseen incoming messages when conversations reload
  useEffect(() => {
    if (!conversationsReady) return;
    const seenIds = seenIdsRef.current;
    const lastSeenAt = lastSeenAtRef.current;
    if (!seededRef.current || seededRef.current.bridge !== bridge) {
      let newest = 0;
      for (const c of conversations) {
        if (!c.lastMessage) continue;
        seenIds.add(c.lastMessage.id);
        const at = Date.parse(c.lastMessage.sentAt) || 0;
        lastSeenAt.set(c.id, Math.max(lastSeenAt.get(c.id) ?? 0, at));
        if (at > newest) newest = at;
      }
      seededRef.current = { bridge, baselineAt: newest || Date.now() - 60_000 };
      return;
    }
    const now = Date.now();
    const missed: Message[] = [];
    for (const c of conversations) {
      const msg = c.lastMessage;
      if (!msg) continue;
      const at = Date.parse(msg.sentAt) || 0;
      const prevAt = lastSeenAt.get(c.id) ?? seededRef.current.baselineAt;
      if (at > (lastSeenAt.get(c.id) ?? 0)) lastSeenAt.set(c.id, at);
      if (seenIds.has(msg.id)) continue;
      seenIds.add(msg.id);
      const fresh = now - at < FRESH_CATCHUP_MS;
      if (!msg.isFromMe && !msg.unsent && (c.unreadCount > 0 || fresh) && at >= prevAt) {
        missed.push(msg);
      }
    }
    if (missed.length > 0) {
      missed.sort((a, b) => (Date.parse(a.sentAt) || 0) - (Date.parse(b.sentAt) || 0));
      void notify(missed);
    }
  }, [bridge, conversations, conversationsReady, notify]);
}
