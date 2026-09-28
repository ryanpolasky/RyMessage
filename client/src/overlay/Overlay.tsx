import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Conversation, Message } from "../api/types";
import { Avatar } from "../components/Avatar";
import type { OverlayNotice } from "../desktop";
import { copyText } from "../desktop";
import { findVerificationCode, formatVerificationCode } from "../utils/verificationCode";

export const OVERLAY_WIDTH = 412;
const LEAVE_MS = 300;
const MAX_CARDS = 4;
const MAX_BUBBLES = 3;
const TAIL = "M5 0v9c0 4-2 7-5 8 4 .2 8-1 10-3 2 2 3.5 3 5 3V0z";
const DRAG_THRESHOLD_PX = 4;
const DISMISS_DISTANCE_PX = 90;
const DISMISS_VELOCITY = -0.6;
const WHEEL_SETTLE_MS = 140;
const FLING_MIN_SPEED = 1.4;
const FLING_MIN_MS = 140;
const FLING_MAX_MS = 280;
const COPIED_LINGER_MS = 900;

interface Card {
  key: string;
  conversation: Conversation;
  messages: Message[];
  leaving: boolean;
  swiped: boolean;
}

function cardKey(notice: OverlayNotice): string {
  return `${notice.conversation.id}:${notice.message.sender?.id ?? ""}`;
}

interface OverlayProps {
  subscribe: (handler: (notice: OverlayNotice) => void) => () => void;
  ttlMs: number | null;
  onOpen: (conversationId: string) => void;
  onUserDismiss: () => void;
  onResize: (height: number) => void;
}

function bubbleText(message: Message): string {
  if (message.text) return message.text;
  const att = message.attachments[0];
  if (!att) return "";
  return att.mimeType.startsWith("image/") ? "Image" : att.fileName;
}

function cardLabel(card: Card): string {
  const last = card.messages[card.messages.length - 1];
  const sender = last.sender?.displayName ?? last.sender?.handle ?? "";
  if (!card.conversation.isGroup) return card.conversation.displayName ?? sender;
  const group =
    card.conversation.displayName ??
    card.conversation.participants.map((p) => p.displayName ?? p.handle).join(", ");
  return `${sender} · ${group}`;
}

function CopyCodeButton({ code, onCopied }: { code: string; onCopied: () => void }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      className={`overlay-code ${state}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        copyText(code).then(
          () => {
            setState("copied");
            onCopied();
          },
          (err) => {
            console.warn("Failed to copy verification code", err);
            setState("failed");
          }
        );
      }}
    >
      {state === "copied" ? (
        <>
          <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6.5l2.5 2.5L10 3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Copied
        </>
      ) : state === "failed" ? (
        "Couldn't copy"
      ) : (
        `Copy Code ${formatVerificationCode(code)}`
      )}
    </button>
  );
}

interface SwipeCardProps {
  card: Card;
  onOpen: () => void;
  onDismiss: (swiped: boolean) => void;
  children: ReactNode;
}

function SwipeCard({ card, onOpen, onDismiss, children }: SwipeCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; lastX: number; lastT: number; velocity: number; moved: boolean } | null>(null);
  const wheel = useRef({ offset: 0, timer: 0 });

  function setOffset(x: number, animate: boolean) {
    const el = ref.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)" : "none";
    el.style.transform = x ? `translateX(${x}px)` : "";
  }

  function release(offset: number, velocity: number) {
    if (offset < -DISMISS_DISTANCE_PX || velocity < DISMISS_VELOCITY) {
      const el = ref.current!;
      const remaining = el.getBoundingClientRect().right + 24;
      const speed = Math.max(Math.abs(velocity), FLING_MIN_SPEED);
      const duration = Math.min(FLING_MAX_MS, Math.max(FLING_MIN_MS, remaining / speed));
      el.style.transition = `transform ${duration}ms cubic-bezier(0.2, 0.7, 0.4, 1)`;
      el.style.transform = `translateX(${offset - remaining}px)`;
      onDismiss(true);
    } else {
      setOffset(0, true);
    }
  }

  return (
    <div
      ref={ref}
      className={`overlay-card ${card.leaving ? "leaving" : ""} ${card.swiped ? "swiped" : ""}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || card.leaving) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, lastX: e.clientX, lastT: e.timeStamp, velocity: 0, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const raw = e.clientX - d.startX;
        if (Math.abs(raw) > DRAG_THRESHOLD_PX) d.moved = true;
        const dt = e.timeStamp - d.lastT;
        if (dt > 0) d.velocity = (e.clientX - d.lastX) / dt;
        d.lastX = e.clientX;
        d.lastT = e.timeStamp;
        if (d.moved) setOffset(raw < 0 ? raw : raw * 0.15, false);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (d.moved) release(e.clientX - d.startX, d.velocity);
        else onOpen();
      }}
      onPointerCancel={() => {
        drag.current = null;
        setOffset(0, true);
      }}
      onWheel={(e) => {
        if (card.leaving || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        const w = wheel.current;
        w.offset = Math.min(0, w.offset - e.deltaX);
        setOffset(w.offset, false);
        clearTimeout(w.timer);
        w.timer = window.setTimeout(() => {
          release(w.offset, 0);
          w.offset = 0;
        }, WHEEL_SETTLE_MS);
      }}
    >
      {children}
    </div>
  );
}

export function Overlay({ subscribe, ttlMs, onOpen, onUserDismiss, onResize }: OverlayProps) {
  const [cards, setCards] = useState<Card[]>([]);
  const timers = useRef(new Map<string, number>());
  const hovered = useRef(false);
  const ttlRef = useRef(ttlMs);
  ttlRef.current = ttlMs;
  const rootRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((key: string, swiped = false) => {
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, leaving: true, swiped } : c)));
    setTimeout(
      () => setCards((prev) => prev.filter((c) => !(c.key === key && c.leaving))),
      LEAVE_MS
    );
  }, []);

  const schedule = useCallback(
    (key: string) => {
      clearTimeout(timers.current.get(key));
      if (hovered.current || ttlRef.current === null) return;
      timers.current.set(key, window.setTimeout(() => dismiss(key), ttlRef.current));
    },
    [dismiss]
  );

  useEffect(
    () =>
      subscribe((notice) => {
        const key = cardKey(notice);
        setCards((prev) => {
          const existing = prev.find((c) => c.key === key && !c.leaving);
          const earlier = (existing?.messages ?? []).filter((m) => m.id !== notice.message.id);
          const card: Card = {
            key,
            conversation: notice.conversation,
            messages: [...earlier, notice.message].slice(-MAX_BUBBLES),
            leaving: false,
            swiped: false,
          };
          return [card, ...prev.filter((c) => c.key !== key)].slice(0, MAX_CARDS);
        });
        schedule(key);
      }),
    [subscribe, schedule]
  );

  useLayoutEffect(() => {
    const root = rootRef.current!;
    const report = () => onResize(cards.length === 0 ? 0 : Math.ceil(root.offsetHeight));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(root);
    return () => observer.disconnect();
  }, [cards.length, onResize]);

  return (
    <div
      className="overlay-root"
      ref={rootRef}
      onMouseEnter={() => {
        hovered.current = true;
        for (const timer of timers.current.values()) clearTimeout(timer);
      }}
      onMouseLeave={() => {
        hovered.current = false;
        for (const card of cards) if (!card.leaving) schedule(card.key);
      }}
    >
      {cards.map((card) => {
        const last = card.messages[card.messages.length - 1];
        const avatar = last.sender ?? card.conversation.participants[0];
        const code = card.messages
          .map((m) => findVerificationCode(m.text))
          .reduce<string | null>((found, next) => next ?? found, null);
        return (
          <SwipeCard
            key={card.key}
            card={card}
            onOpen={() => {
              onUserDismiss();
              onOpen(card.conversation.id);
              dismiss(card.key);
            }}
            onDismiss={(swiped) => {
              onUserDismiss();
              dismiss(card.key, swiped);
            }}
          >
            <div className="overlay-label-row">
              <div className="overlay-label">{cardLabel(card)}</div>
              {code && (
                <CopyCodeButton
                  code={code}
                  onCopied={() => {
                    onUserDismiss();
                    setTimeout(() => dismiss(card.key), COPIED_LINGER_MS);
                  }}
                />
              )}
            </div>
            <div className="overlay-row">
              <div className="overlay-avatar">
                {avatar && <Avatar participant={avatar} size={30} />}
              </div>
              <div className="overlay-bubbles">
                {card.messages.map((message) => (
                  <div key={message.id} className="overlay-bubble">
                    <span className="overlay-bubble-text">{bubbleText(message)}</span>
                    {message === last && (
                      <svg className="overlay-tail" viewBox="0 0 15 17" width="15" height="17">
                        <path d={TAIL} />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </SwipeCard>
        );
      })}
    </div>
  );
}
