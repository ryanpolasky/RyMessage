import { useEffect } from "react";
import type { Message, TapbackKind } from "../api/types";
import { copyText } from "../desktop";
import { findVerificationCode, formatVerificationCode } from "../utils/verificationCode";
import { TAPBACKS, TapbackIcon } from "./Tapback";

export interface MessageMenuState {
  message: Message;
  anchor: DOMRect;
  canReact: boolean;
  canReply: boolean;
}

interface MessageMenuProps {
  menu: MessageMenuState;
  onReact: (message: Message, kind: TapbackKind | null) => void;
  onReply: (message: Message) => void;
  onClose: () => void;
}

const EDGE = 8;
const GAP = 6;
const PICKER_WIDTH = 204;
const PICKER_HEIGHT = 42;
const MENU_WIDTH = 170;
const MENU_ITEM_HEIGHT = 22;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function MessageMenu({ menu, onReact, onReply, onClose }: MessageMenuProps) {
  const { message, anchor, canReact, canReply } = menu;
  const mine = message.reactions.find((r) => r.isFromMe)?.kind ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items: { label: string; run: () => void }[] = [];
  if (canReply) items.push({ label: "Reply", run: () => onReply(message) });
  const code = message.isFromMe ? null : findVerificationCode(message.text);
  if (code) {
    items.push({ label: `Copy Code ${formatVerificationCode(code)}`, run: () => void copyText(code) });
  }
  if (message.text) {
    const text = message.text;
    items.push({ label: "Copy", run: () => void copyText(text) });
  }

  const hasMenu = items.length > 0;
  const menuHeight = hasMenu ? items.length * MENU_ITEM_HEIGHT + 10 : 0;
  const pickerHeight = canReact ? PICKER_HEIGHT : 0;
  const bottomLimit = window.innerHeight - EDGE;

  // tapbacks sit above the bubble and the menu below it; near the bottom both stack above
  const menuBelow = !hasMenu || anchor.bottom + GAP + menuHeight <= bottomLimit;
  let menuTop: number;
  let pickerTop: number;
  if (menuBelow) {
    menuTop = anchor.bottom + GAP;
    const roomAbove = anchor.top - GAP - pickerHeight >= EDGE;
    pickerTop = roomAbove
      ? anchor.top - GAP - pickerHeight
      : (hasMenu ? menuTop + menuHeight : anchor.bottom) + GAP;
  } else {
    menuTop = Math.max(EDGE, anchor.top - GAP - menuHeight);
    pickerTop = Math.max(EDGE, menuTop - GAP - pickerHeight);
  }
  const pickerBelow = pickerTop > anchor.top;

  const alignRight = message.isFromMe;
  const pickerLeft = clamp(
    alignRight ? anchor.right - PICKER_WIDTH : anchor.left,
    EDGE,
    window.innerWidth - PICKER_WIDTH - EDGE
  );
  const menuLeft = clamp(
    alignRight ? anchor.right - MENU_WIDTH : anchor.left,
    EDGE,
    window.innerWidth - MENU_WIDTH - EDGE
  );

  return (
    <div
      className="context-overlay"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {canReact && (
        <div
          className={`tapback-picker ${alignRight ? "grow-left" : ""} ${pickerBelow ? "below" : ""}`}
          style={{ left: pickerLeft, top: pickerTop }}
        >
          {TAPBACKS.map(({ kind, label }, i) => (
            <button
              key={kind}
              className={`tapback-option ${mine === kind ? "selected" : ""}`}
              style={{ "--i": i } as React.CSSProperties}
              title={label}
              onClick={() => onReact(message, mine === kind ? null : kind)}
            >
              <TapbackIcon kind={kind} size={18} />
            </button>
          ))}
        </div>
      )}
      {hasMenu && (
        <div
          className={`context-menu message-menu ${alignRight ? "align-right" : ""} ${menuBelow ? "" : "above"}`}
          style={{ left: menuLeft, top: menuTop, width: MENU_WIDTH }}
        >
          {items.map((item) => (
            <button key={item.label} className="context-item" onClick={item.run}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
