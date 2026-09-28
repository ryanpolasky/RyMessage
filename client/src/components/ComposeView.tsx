import { useEffect, useMemo, useRef, useState } from "react";
import type { Capabilities, Conversation } from "../api/types";
import type { DirectoryEntry } from "../contacts";
import { looksLikeHandle, normalizeHandle } from "../utils/handles";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";

interface Recipient {
  handle: string;
  label: string;
}

interface Suggestion {
  entry: DirectoryEntry;
  handle: string;
}

interface ComposeViewProps {
  directory: DirectoryEntry[];
  conversations: Conversation[];
  capabilities: Capabilities | null;
  onOpenConversation: (id: string) => void;
  onStart: (to: string[], text: string) => Promise<void>;
  onCancel: () => void;
}

const MAX_SUGGESTIONS = 6;

function matches(entry: DirectoryEntry, handle: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (entry.displayName?.toLowerCase().split(/\s+/).some((word) => word.startsWith(q))) return true;
  if (entry.displayName?.toLowerCase().startsWith(q)) return true;
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 3 && handle.replace(/\D/g, "").includes(digits)) return true;
  return handle.toLowerCase().includes(q) && q.length >= 2;
}

export function ComposeView({
  directory,
  conversations,
  capabilities,
  onOpenConversation,
  onStart,
  onCancel,
}: ComposeViewProps) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<{ text: string; reason: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const canCompose = capabilities?.compose ?? false;
  const canGroup = capabilities?.groupCompose ?? false;
  const full = !canGroup && recipients.length >= 1;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!query.trim()) return [];
    const taken = new Set(recipients.map((r) => normalizeHandle(r.handle)));
    const out: Suggestion[] = [];
    for (const entry of directory) {
      for (const handle of entry.handles) {
        if (taken.has(normalizeHandle(handle)) || !matches(entry, handle, query)) continue;
        out.push({ entry, handle });
        if (out.length === MAX_SUGGESTIONS) return out;
      }
    }
    return out;
  }, [directory, query, recipients]);

  function focusMessage() {
    bodyRef.current?.parentElement?.querySelector<HTMLTextAreaElement>(".composer-field textarea")?.focus();
  }

  function addRecipient(handle: string, label: string) {
    setQuery("");
    setActive(0);
    setFailed(null);
    if (recipients.length === 0) {
      const key = normalizeHandle(handle);
      const existing = conversations.find(
        (c) => !c.isGroup && c.participants.length === 1 && normalizeHandle(c.participants[0].handle) === key
      );
      if (existing) return onOpenConversation(existing.id);
    }
    setRecipients((prev) => [...prev, { handle, label }]);
    requestAnimationFrame(() => (canGroup ? inputRef.current?.focus() : focusMessage()));
  }

  async function send(text: string) {
    setSending(true);
    setFailed(null);
    try {
      await onStart(
        recipients.map((r) => r.handle),
        text
      );
    } catch (e) {
      setFailed({ text, reason: e instanceof Error ? e.message : String(e) });
      setSending(false);
    }
  }

  return (
    <section
      className="chat-view compose-view"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !sending) onCancel();
      }}
    >
      <div className="compose-header">
        <span className="compose-to">To:</span>
        <div className="compose-recipients" onMouseDown={(e) => e.target === e.currentTarget && inputRef.current?.focus()}>
          {recipients.map((r) => (
            <span key={r.handle} className="recipient-chip" title={r.handle}>
              {r.label}
            </span>
          ))}
          <input
            ref={inputRef}
            className="compose-input"
            value={query}
            disabled={full || sending}
            placeholder={recipients.length === 0 ? "Name, phone number, or email" : ""}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && suggestions.length) {
                e.preventDefault();
                setActive((i) => (i + 1) % suggestions.length);
              } else if (e.key === "ArrowUp" && suggestions.length) {
                e.preventDefault();
                setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
              } else if (e.key === "Enter" || e.key === "Tab") {
                const pick = suggestions[active];
                if (pick) {
                  e.preventDefault();
                  addRecipient(pick.handle, pick.entry.displayName ?? pick.handle);
                } else if (looksLikeHandle(query)) {
                  e.preventDefault();
                  addRecipient(query.trim(), query.trim());
                }
              } else if (e.key === "Backspace" && !query && recipients.length) {
                setRecipients((prev) => prev.slice(0, -1));
              }
            }}
          />
        </div>
        {suggestions.length > 0 && (
          <div className="compose-suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <button
                key={`${s.entry.id}:${s.handle}`}
                role="option"
                aria-selected={i === active}
                className={`compose-suggestion ${i === active ? "active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addRecipient(s.handle, s.entry.displayName ?? s.handle);
                }}
              >
                <Avatar
                  participant={{
                    id: s.entry.id,
                    displayName: s.entry.displayName,
                    handle: s.handle,
                    avatarUrl: s.entry.avatarUrl,
                  }}
                  size={28}
                />
                <span className="compose-suggestion-text">
                  <span className="compose-suggestion-name">{s.entry.displayName ?? s.handle}</span>
                  {s.entry.displayName && <span className="compose-suggestion-handle">{s.handle}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="compose-body" ref={bodyRef}>
        {!canCompose && <p className="compose-note">This server can't start new conversations yet.</p>}
        {full && canCompose && <p className="compose-note">New group chats aren't supported by this server.</p>}
        {sending && <p className="compose-note">Sending…</p>}
        {failed && (
          <div className="load-error">
            <span>Couldn't send “{failed.text}”</span>
            <span className="load-error-detail">{failed.reason}</span>
            <button className="link-button" onClick={() => send(failed.text)}>
              Try Again
            </button>
          </div>
        )}
      </div>
      <Composer
        conversationId="compose"
        service="iMessage"
        ready={recipients.length > 0 && !sending}
        canSendText={canCompose}
        canAttach={false}
        replyTargetId={null}
        onCancelReply={() => {}}
        onSendText={send}
        onSendFile={() => {}}
      />
    </section>
  );
}
