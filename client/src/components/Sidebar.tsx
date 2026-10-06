import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "../api/bridge";
import type { Conversation } from "../api/types";
import { messagePreview } from "../utils/attachments";
import { EASE_OUT_EXPO, prefersReducedMotion } from "../utils/motion";
import { sidebarTimestamp } from "../utils/time";
import { Avatar, ConversationAvatar } from "./Avatar";

interface SidebarProps {
  conversations: Conversation[];
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTogglePin: (id: string, currentlyPinned: boolean) => void;
  onDelete: (id: string) => void;
  status: ConnectionStatus;
  connectionLabel: string;
  disconnectLabel: string;
  onDisconnect: () => void;
  onOpenSettings: () => void;
  composing: boolean;
  canCompose: boolean;
  onCompose: () => void;
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
  return conversation.lastMessage ? messagePreview(conversation.lastMessage) : "";
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
  onDelete,
  status,
  connectionLabel,
  disconnectLabel,
  onDisconnect,
  onOpenSettings,
  composing,
  canCompose,
  onCompose,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Conversation | null>(null);

  useEffect(() => {
    if (!confirmDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmDelete(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete]);

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
        <div className="search-field">
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
        <button
          className="icon-button compose-button"
          onClick={onCompose}
          disabled={!canCompose}
          title={canCompose ? "New Message (Ctrl+N)" : "This server can't start new conversations yet"}
        >
          <svg
            viewBox="0 0 16 16"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7.5 2.5H4A1.5 1.5 0 0 0 2.5 4v8A1.5 1.5 0 0 0 4 13.5h8a1.5 1.5 0 0 0 1.5-1.5V8.5" />
            <path d="M11.8 2.2a1.3 1.3 0 0 1 1.9 1.9L8.3 9.5 6 10l.5-2.3z" />
          </svg>
        </button>
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
        {composing && (
          <div className="conversation-row selected new-message-row">
            <span className="unread-dot" />
            <Avatar participant={{ id: "new", displayName: null, handle: "", avatarUrl: null }} size={44} />
            <div className="conversation-text">
              <div className="conversation-top">
                <span className="conversation-name">New Message</span>
              </div>
            </div>
          </div>
        )}
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
        <div className="sidebar-footer-actions">
          <button className="icon-button" onClick={onOpenSettings} title="Settings (Ctrl+,)">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor">
              <circle cx="8" cy="8" r="4.4" strokeWidth="1.5" />
              <circle cx="8" cy="8" r="1.6" strokeWidth="1.5" />
              <path
                d="M8 1.6v1.9M8 12.5v1.9M1.6 8h1.9M12.5 8h1.9M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M3.5 12.5l1.3-1.3M11.2 4.8l1.3-1.3"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button className="link-button" onClick={onDisconnect}>
            {disconnectLabel}
          </button>
        </div>
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
            <div className="context-separator" />
            <button
              className="context-item"
              onClick={() => {
                setConfirmDelete(menu.conversation);
                setMenu(null);
              }}
            >
              Delete Conversation…
            </button>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="alert-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="alert" role="alertdialog" aria-labelledby="delete-title">
            <h2 id="delete-title">Delete this conversation?</h2>
            <p>
              It's removed from RyMessage on this PC. Your Mac and iPhone keep it, and it comes back here if a new
              message arrives.
            </p>
            <div className="alert-actions">
              <button className="settings-button" autoFocus onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button
                className="settings-button alert-destructive"
                onClick={() => {
                  onDelete(confirmDelete.id);
                  setConfirmDelete(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
