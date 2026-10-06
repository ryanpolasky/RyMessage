import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Attachment, Capabilities, Conversation, Message, TapbackKind } from "../api/types";
import { attachmentLabel, unsentNote } from "../utils/attachments";
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
const THREAD_INSET_PX = 8;
const THREAD_RADIUS_PX = 8;
const MAX_JUMBO = 3;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const EMOJI_GRAPHEME = /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)/u;

interface ThreadLine {
  key: string;
  fromMe: boolean;
  x: number;
  top: number;
  bottom: number;
  target: number;
}

function jumboCount(message: Message): number {
  if (!message.text || message.attachments.length > 0) return 0;
  const parts = [...graphemes.segment(message.text.replace(/\s/g, ""))];
  if (parts.length === 0 || parts.length > MAX_JUMBO) return 0;
  return parts.every((p) => EMOJI_GRAPHEME.test(p.segment)) ? parts.length : 0;
}

function threadPath(line: ThreadLine): { left: number; width: number; height: number; d: string } {
  const width = Math.max(1, Math.abs(line.target - line.x));
  const height = Math.max(1, line.bottom - line.top);
  const r = Math.min(THREAD_RADIUS_PX, width, height);
  const d = line.fromMe
    ? `M${width} 0V${height - r}Q${width} ${height} ${width - r} ${height}H0`
    : `M0 0V${height - r}Q0 ${height} ${r} ${height}H${width}`;
  return { left: Math.min(line.x, line.target), width, height, d };
}

function sameSender(a: Message, b: Message): boolean {
  if (a.isFromMe !== b.isFromMe) return false;
  return (a.sender?.id ?? "me") === (b.sender?.id ?? "me");
}

function gapMs(a: Message, b: Message): number {
  return new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime();
}

function isVisualMedia(attachment: Attachment): boolean {
  return attachment.mimeType.startsWith("image/") || attachment.mimeType.startsWith("video/");
}

function quoteText(message: Message): string {
  if (message.unsent) return unsentNote(message);
  if (message.text) return message.text;
  return message.attachments[0] ? attachmentLabel(message.attachments[0]) : "";
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
  const [threadLines, setThreadLines] = useState<ThreadLine[]>([]);

  // consecutive replies from one sender to the same message share a single quote
  const runStart = useMemo(() => {
    const starts: number[] = [];
    messages.forEach((m, i) => {
      const prev = messages[i - 1];
      const continues =
        prev !== undefined &&
        !m.unsent &&
        !prev.unsent &&
        m.replyTo != null &&
        prev.replyTo === m.replyTo &&
        sameSender(prev, m) &&
        gapMs(prev, m) <= SEPARATOR_GAP_MS;
      starts.push(continues ? starts[i - 1] : i);
    });
    return starts;
  }, [messages]);

  const measureThreads = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const box = content.getBoundingClientRect();
    const next: ThreadLine[] = [];
    for (const start of content.querySelectorAll<HTMLElement>("[data-thread-start]")) {
      const key = start.dataset.threadStart!;
      const end = content.querySelector<HTMLElement>(`[data-thread-end="${CSS.escape(key)}"]`);
      if (!end) continue;
      const s = start.getBoundingClientRect();
      const e = end.getBoundingClientRect();
      const fromMe = start.dataset.side === "me";
      next.push({
        key,
        fromMe,
        x: fromMe ? s.right - box.left - THREAD_INSET_PX : s.left - box.left + THREAD_INSET_PX,
        top: s.bottom - box.top,
        bottom: e.top - box.top + e.height / 2,
        target: fromMe ? e.right - box.left : e.left - box.left,
      });
    }
    setThreadLines((prev) =>
      prev.length === next.length &&
      prev.every((p, i) => JSON.stringify(p) === JSON.stringify(next[i]))
        ? prev
        : next
    );
  }, []);

  useLayoutEffect(measureThreads, [messages, measureThreads]);

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
      measureThreads();
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
    .find((m) => m.isFromMe && !m.unsent && (m.status === "delivered" || m.status === "read"));

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
      <div ref={contentRef} className="message-content">
        {threadLines.map((line) => {
          const { left, width, height, d } = threadPath(line);
          return (
            <svg
              key={line.key}
              className="thread-line"
              style={{ left, top: line.top, width, height }}
              viewBox={`0 0 ${width} ${height}`}
            >
              <path d={d} />
            </svg>
          );
        })}
        {messages.map((message, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const next = i < messages.length - 1 ? messages[i + 1] : null;
          const showSeparator = !prev || gapMs(prev, message) > SEPARATOR_GAP_MS;
          if (message.unsent) {
            return (
              <div key={message.clientId ?? message.id}>
                {showSeparator && (
                  <div className="time-separator">
                    <strong>{separatorParts(message.sentAt).day}</strong>{" "}
                    {separatorParts(message.sentAt).time}
                  </div>
                )}
                <div className="unsent-note">{unsentNote(message)}</div>
              </div>
            );
          }
          const firstInGroup =
            showSeparator ||
            !prev ||
            !!prev.unsent ||
            !sameSender(prev, message) ||
            gapMs(prev, message) > GROUP_GAP_MS;
          const lastInGroup =
            !next ||
            !!next.unsent ||
            !sameSender(message, next) ||
            gapMs(message, next) > GROUP_GAP_MS ||
            gapMs(message, next) > SEPARATOR_GAP_MS;
          const showSenderName = conversation.isGroup && !message.isFromMe && firstInGroup;
          const showAvatar = conversation.isGroup && !message.isFromMe && lastInGroup;

          const isNew = !initialIds.has(message.id);
          const media = message.attachments.filter(isVisualMedia);
          const files = message.attachments.filter((a) => !isVisualMedia(a));
          const parts: (Attachment | null)[] = [...media, ...(message.text || files.length ? [null] : [])];
          const original = message.replyTo != null ? byId.get(message.replyTo) : undefined;
          const quoteFromMe = original ? original.isFromMe : message.isFromMe;
          const inThread = message.replyTo != null;
          const firstOfRun = messages[runStart[i]];
          const threadKey = firstOfRun.clientId ?? firstOfRun.id;
          const startsRun = runStart[i] === i;
          const endsRun = runStart[i + 1] !== runStart[i];
          const jumbo = jumboCount(message);
          const sideClasses = [
            message.isFromMe ? "from-me" : "from-them",
            conversation.isGroup && !message.isFromMe ? "with-gutter" : "",
            inThread ? "in-thread" : "",
          ];

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
              {inThread && startsRun && (
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
                    data-thread-start={threadKey}
                    data-side={message.isFromMe ? "me" : "them"}
                    disabled={!original}
                    onClick={() => original && jumpTo(original.id)}
                  >
                    {original ? quoteText(original) : "Earlier message"}
                  </button>
                </div>
              )}
              {parts.map((part, index) => {
                const last = index === parts.length - 1;
                return (
                  <div
                    key={part ? `media-${index}` : "text"}
                    className={[
                      "bubble-row",
                      ...sideClasses,
                      message.isFromMe && message.service === "SMS" ? "sms" : "",
                      last && lastInGroup ? "last-in-group" : "",
                      last && message.reactions.length > 0 ? "has-reactions" : "",
                      last ? "" : "part-of-message",
                    ].join(" ")}
                  >
                    {last && showAvatar && message.sender && (
                      <div className="bubble-avatar">
                        <Avatar participant={message.sender} size={24} />
                      </div>
                    )}
                    <div
                      data-message-id={index === 0 ? message.id : undefined}
                      data-thread-end={inThread && endsRun && last ? threadKey : undefined}
                      className={[
                        "bubble",
                        isNew ? "bubble-new" : "",
                        part ? "bubble-media" : "",
                        jumbo ? `bubble-emoji jumbo-${jumbo}` : "",
                        menu?.message.id === message.id ? "bubble-active" : "",
                      ].join(" ")}
                      onContextMenu={(e) => openMenu(e, message)}
                    >
                      {part ? (
                        <AttachmentView attachment={part} loadAttachment={loadAttachment} />
                      ) : (
                        <>
                          {files.map((att, fileIndex) => (
                            <AttachmentView key={fileIndex} attachment={att} loadAttachment={loadAttachment} />
                          ))}
                          {message.text && <span className="bubble-text">{message.text}</span>}
                        </>
                      )}
                      {last && <ReactionBadges reactions={message.reactions} />}
                    </div>
                  </div>
                );
              })}
              {message.editedAt && (
                <div className={["message-edited", ...sideClasses].join(" ")}>Edited</div>
              )}
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
