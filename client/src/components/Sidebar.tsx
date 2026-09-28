import { useLayoutEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "../api/bridge";
import type { Conversation } from "../api/types";
import { EASE_OUT_EXPO, prefersReducedMotion } from "../utils/motion";
import { sidebarTimestamp } from "../utils/time";
import { ConversationAvatar } from "./Avatar";

interface SidebarProps {
  conversations: Conversation[];
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTogglePin: (id: string, currentlyPinned: boolean) => void;
  status: ConnectionStatus;
  connectionLabel: string;
  disconnectLabel: string;
  onDisconnect: () => void;
}

const STATUS_LABELS: Record<Exclude<ConnectionStatus, "online">, string> = {
  connecting: "Connecting…",
  offline: "Offline, reconnecting…",
  unauthorized: "Token rejected, pair again",
};

interface MenuState {
  x: number;
  y: number;
  conversation: Conversation;
}

function preview(conversation: Conversation): string {
  const last = conversation.lastMessage;
  if (!last) return "";
  if (last.text) return last.text;
  if (last.attachments.length > 0) {
    const att = last.attachments[0];
    return att.mimeType.startsWith("image/") ? "Image" : att.fileName;
  }
  return "";
}

function displayName(conversation: Conversation): string {
  return (
    conversation.displayName ??
    conversation.participants.map((p) => p.displayName ?? p.handle).join(", ")
  );
}

export function Sidebar({
  conversations,
  loading,
  loadError,
  onRetry,
  selectedId,
  onSelect,
  onTogglePin,
  status,
  connectionLabel,
  disconnectLabel,
  onDisconnect,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);

  function openMenu(e: React.MouseEvent, conversation: Conversation) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, conversation });
  }
  const filtered = query
    ? conversations.filter((c) => displayName(c).toLowerCase().includes(query.toLowerCase()))
    : conversations;
  const pinned = filtered.filter((c) => c.pinned);
  const unpinned = filtered.filter((c) => !c.pinned);

  const listRef = useRef<HTMLDivElement>(null);
  const rowTops = useRef(new Map<string, number>());
  const order = unpinned.map((c) => c.id).join("|");
  useLayoutEffect(() => {
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [];
    const animate = !prefersReducedMotion();
    const next = new Map<string, number>();
    for (const row of rows) {
      const id = row.dataset.rowId!;
      const top = row.offsetTop;
      const before = rowTops.current.get(id);
      next.set(id, top);
      if (animate && before !== undefined && before !== top) {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], {
          duration: 420,
          easing: EASE_OUT_EXPO,
        });
      }
    }
    rowTops.current = next;
  }, [order]);

  return (
    <aside className="sidebar">
      <div className="sidebar-search">
        <svg className="search-icon" viewBox="0 0 16 16" width="13" height="13">
          <path
            d="M6.5 1a5.5 5.5 0 1 0 3.37 9.85l3.14 3.14a.75.75 0 1 0 1.06-1.06l-3.14-3.14A5.5 5.5 0 0 0 6.5 1zM2.5 6.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0z"
            fill="currentColor"
          />
        </svg>
        <input
          type="text"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {pinned.length > 0 && (
        <div className="pinned-section">
          {pinned.map((c) => (
            <button
              key={c.id}
              className={`pinned-item ${c.id === selectedId ? "selected" : ""}`}
              onClick={() => onSelect(c.id)}
              onContextMenu={(e) => openMenu(e, c)}
            >
              <div className="pinned-avatar">
                <ConversationAvatar conversation={c} size={52} />
                {c.unreadCount > 0 && <span className="pinned-unread" />}
              </div>
              <span className="pinned-name">{displayName(c).split(" ")[0]}</span>
            </button>
          ))}
        </div>
      )}
      <div className="conversation-list" ref={listRef}>
        {loadError && (
          <div className="load-error">
            <span>Couldn't load conversations.</span>
            <span className="load-error-detail">{loadError}</span>
            <button className="link-button" onClick={onRetry}>
              Try Again
            </button>
          </div>
        )}
        {loading && <div className="loading-spinner sidebar-spinner" />}
        {unpinned.map((c) => (
          <button
            key={c.id}
            data-row-id={c.id}
            className={`conversation-row ${c.id === selectedId ? "selected" : ""}`}
            onClick={() => onSelect(c.id)}
            onContextMenu={(e) => openMenu(e, c)}
          >
            <span className={`unread-dot ${c.unreadCount > 0 ? "visible" : ""}`} />
            <ConversationAvatar conversation={c} size={44} />
            <div className="conversation-text">
              <div className="conversation-top">
                <span className="conversation-name">{displayName(c)}</span>
                <span className="conversation-time">
                  {c.lastMessage ? sidebarTimestamp(c.lastMessage.sentAt) : ""}
                </span>
              </div>
              <div className="conversation-preview">{preview(c)}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <span className="sidebar-footer-label">
          {status !== "online" && <span className={`status-dot ${status}`} />}
          {status === "online" ? connectionLabel : STATUS_LABELS[status]}
        </span>
        <button className="link-button" onClick={onDisconnect}>
          {disconnectLabel}
        </button>
      </div>
      {menu && (
        <div
          className="context-overlay"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(null);
          }}
        >
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <button
              className="context-item"
              onClick={() => {
                onTogglePin(menu.conversation.id, menu.conversation.pinned);
                setMenu(null);
              }}
            >
              {menu.conversation.pinned ? "Unpin" : "Pin"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
