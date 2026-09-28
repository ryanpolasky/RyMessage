import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Attachment, Capabilities, Conversation, Message, TapbackKind } from "../api/types";
import { EASE_OUT_EXPO, prefersReducedMotion } from "../utils/motion";
import { separatorParts } from "../utils/time";
import { AttachmentView } from "./AttachmentView";
import { Avatar } from "./Avatar";
import type { MessageMenuState } from "./MessageMenu";
import { MessageMenu } from "./MessageMenu";
import { ReactionBadges } from "./Tapback";

interface MessageListProps {
  conversation: Conversation;
  messages: Message[];
  capabilities: Capabilities | null;
  loadAttachment: (attachment: Attachment) => Promise<Blob>;
  onReact: (message: Message, kind: TapbackKind | null) => void;
  onReply: (message: Message) => void;
}

const GROUP_GAP_MS = 60_000;
const SEPARATOR_GAP_MS = 30 * 60_000;
const BOTTOM_THRESHOLD_PX = 40;
const GLIDE_MS = 320;

function sameSender(a: Message, b: Message): boolean {
  if (a.isFromMe !== b.isFromMe) return false;
  return (a.sender?.id ?? "me") === (b.sender?.id ?? "me");
}

function gapMs(a: Message, b: Message): number {
  return new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime();
}

function quoteText(message: Message): string {
  if (message.text) return message.text;
  const att = message.attachments[0];
  if (!att) return "";
  return att.mimeType.startsWith("image/") ? "Image" : att.fileName;
}

export function MessageList({
  conversation,
  messages,
  capabilities,
  loadAttachment,
  onReact,
  onReply,
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const [menu, setMenu] = useState<MessageMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  function jumpTo(id: string) {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("bubble-flash");
    void el.offsetWidth;
    el.classList.add("bubble-flash");
  }

  function openMenu(e: React.MouseEvent<HTMLDivElement>, message: Message) {
    const confirmed = !message.id.startsWith("local-") && message.status !== "failed";
    const canReact = confirmed && !!capabilities?.reactions;
    const canReply = confirmed && !!capabilities?.replies;
    if (!canReact && !canReply && !message.text) return;
    e.preventDefault();
    setMenu({
      message,
      anchor: e.currentTarget.getBoundingClientRect(),
      x: e.clientX,
      y: e.clientY,
      canReact,
      canReply,
    });
  }
  const initialRef = useRef<{ id: string; ids: Set<string> } | null>(null);
  if (initialRef.current?.id !== conversation.id) {
    initialRef.current = { id: conversation.id, ids: new Set(messages.map((m) => m.id)) };
  }
  const initialIds = initialRef.current.ids;

  const glideRef = useRef<number | null>(null);

  function cancelGlide() {
    if (glideRef.current !== null) cancelAnimationFrame(glideRef.current);
    glideRef.current = null;
  }

  function scrollToBottom() {
    cancelGlide();
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }

  function glideToBottom() {
    const list = listRef.current;
    if (!list) return;
    if (prefersReducedMotion()) return scrollToBottom();
    cancelGlide();
    const start = list.scrollTop;
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / GLIDE_MS);
      const target = list.scrollHeight - list.clientHeight;
      list.scrollTop = start + (target - start) * (1 - Math.pow(1 - t, 3));
      glideRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    glideRef.current = requestAnimationFrame(step);
  }

  useLayoutEffect(() => {
    pinnedToBottomRef.current = true;
    scrollToBottom();
    if (!prefersReducedMotion()) {
      contentRef.current?.animate(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 240, easing: EASE_OUT_EXPO }
      );
    }
  }, [conversation.id]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (pinnedToBottomRef.current) glideToBottom();
    });
    observer.observe(listRef.current!);
    observer.observe(contentRef.current!);
    return () => {
      observer.disconnect();
      cancelGlide();
    };
  }, []);

  const last = messages[messages.length - 1];
  const lastKey = last ? (last.clientId ?? last.id) : null;
  useLayoutEffect(() => {
    if (last?.isFromMe && !initialIds.has(last.id)) {
      pinnedToBottomRef.current = true;
      glideToBottom();
    }
  }, [lastKey]);

  const lastDelivered = [...messages]
    .reverse()
    .find((m) => m.isFromMe && (m.status === "delivered" || m.status === "read"));

  return (
    <div
      className="message-list"
      ref={listRef}
      onScroll={(e) => {
        if (glideRef.current !== null) return;
        const el = e.currentTarget;
        pinnedToBottomRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
      }}
      onWheel={cancelGlide}
      onPointerDown={cancelGlide}
    >
      <div ref={contentRef}>
        {messages.map((message, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const next = i < messages.length - 1 ? messages[i + 1] : null;
          const showSeparator = !prev || gapMs(prev, message) > SEPARATOR_GAP_MS;
          const firstInGroup =
            showSeparator || !prev || !sameSender(prev, message) || gapMs(prev, message) > GROUP_GAP_MS;
          const lastInGroup =
            !next ||
            !sameSender(message, next) ||
            gapMs(message, next) > GROUP_GAP_MS ||
            gapMs(message, next) > SEPARATOR_GAP_MS;
          const showSenderName = conversation.isGroup && !message.isFromMe && firstInGroup;
          const showAvatar = conversation.isGroup && !message.isFromMe && lastInGroup;

          const isNew = !initialIds.has(message.id);
          const mediaOnly =
            !message.text &&
            message.attachments.length > 0 &&
            message.attachments.every((a) => a.mimeType.startsWith("image/"));
          const original = message.replyTo != null ? byId.get(message.replyTo) : undefined;
          const quoteFromMe = original ? original.isFromMe : message.isFromMe;

          return (
            <div key={message.clientId ?? message.id}>
              {showSeparator && (
                <div className="time-separator">
                  <strong>{separatorParts(message.sentAt).day}</strong>{" "}
                  {separatorParts(message.sentAt).time}
                </div>
              )}
              {showSenderName && message.sender && (
                <div className="sender-name">
                  {message.sender.displayName ?? message.sender.handle}
                </div>
              )}
              {message.replyTo != null && (
                <div
                  className={[
                    "reply-quote-row",
                    message.isFromMe ? "align-right" : "",
                    conversation.isGroup && !message.isFromMe ? "with-gutter" : "",
                  ].join(" ")}
                >
                  <button
                    className={[
                      "reply-quote",
                      quoteFromMe ? "from-me" : "from-them",
                      quoteFromMe && original?.service === "SMS" ? "sms" : "",
                    ].join(" ")}
                    disabled={!original}
                    onClick={() => original && jumpTo(original.id)}
                  >
                    {original ? quoteText(original) : "Earlier message"}
                  </button>
                </div>
              )}
              <div
                className={[
                  "bubble-row",
                  message.isFromMe ? "from-me" : "from-them",
                  message.isFromMe && message.service === "SMS" ? "sms" : "",
                  lastInGroup ? "last-in-group" : "",
                  conversation.isGroup && !message.isFromMe ? "with-gutter" : "",
                  message.reactions.length > 0 ? "has-reactions" : "",
                ].join(" ")}
              >
                {showAvatar && message.sender && (
                  <div className="bubble-avatar">
                    <Avatar participant={message.sender} size={24} />
                  </div>
                )}
                <div
                  data-message-id={message.id}
                  className={[
                    "bubble",
                    isNew ? "bubble-new" : "",
                    mediaOnly ? "bubble-media" : "",
                    menu?.message.id === message.id ? "bubble-active" : "",
                  ].join(" ")}
                  onContextMenu={(e) => openMenu(e, message)}
                >
                  {message.attachments.map((att, index) => (
                    <AttachmentView key={index} attachment={att} loadAttachment={loadAttachment} />
                  ))}
                  {message.text && <span className="bubble-text">{message.text}</span>}
                  <ReactionBadges reactions={message.reactions} />
                </div>
              </div>
              {message.isFromMe && message.status === "sending" && (
                <div className="message-status">Sending...</div>
              )}
              {message.isFromMe && message.status === "failed" && (
                <div className="message-status failed">Not Delivered</div>
              )}
              {message === lastDelivered && message === messages[messages.length - 1] && (
                <div className="message-status">
                  {message.status === "read" ? "Read" : "Delivered"}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {menu && (
        <MessageMenu menu={menu} onReact={onReact} onReply={onReply} onClose={closeMenu} />
      )}
    </div>
  );
}
