import { useEffect } from "react";
import type { Message, TapbackKind } from "../api/types";
import { TAPBACKS, TapbackIcon } from "./Tapback";

export interface MessageMenuState {
  message: Message;
  anchor: DOMRect;
  x: number;
  y: number;
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
const PICKER_WIDTH = 204;
const PICKER_HEIGHT = 42;
const MENU_WIDTH = 150;
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
  if (message.text) {
    const text = message.text;
    items.push({ label: "Copy", run: () => navigator.clipboard.writeText(text) });
  }

  const pickerAbove = anchor.top - PICKER_HEIGHT - EDGE >= EDGE;
  const pickerTop = pickerAbove ? anchor.top - PICKER_HEIGHT - 6 : anchor.bottom + 6;
  const pickerLeft = clamp(
    message.isFromMe ? anchor.right - PICKER_WIDTH : anchor.left,
    EDGE,
    window.innerWidth - PICKER_WIDTH - EDGE
  );
  const menuHeight = items.length * MENU_ITEM_HEIGHT + 10;
  const minMenuTop = canReact && !pickerAbove ? pickerTop + PICKER_HEIGHT + 6 : EDGE;
  const menuTop = clamp(menu.y, minMenuTop, window.innerHeight - menuHeight - EDGE);
  const menuLeft = clamp(menu.x, EDGE, window.innerWidth - MENU_WIDTH - EDGE);

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
          className={`tapback-picker ${message.isFromMe ? "grow-left" : ""} ${pickerAbove ? "" : "below"}`}
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
      {items.length > 0 && (
        <div className="context-menu" style={{ left: menuLeft, top: menuTop, minWidth: MENU_WIDTH }}>
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
