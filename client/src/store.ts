import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionStatus, RyMessageBridge } from "./api/bridge";
import type { Attachment, Capabilities, Conversation, Message, TapbackKind } from "./api/types";

const PAGE_SIZE = 100;
const PINS_KEY = "rymessage.pins";
const READ_KEY = "rymessage.readThrough";
const HIDDEN_KEY = "rymessage.hidden";

function loadRecord<T>(key: string): Record<string, T> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}

function usePersistedRecord<T>(key: string) {
  const [record, setRecord] = useState<Record<string, T>>(() => loadRecord<T>(key));
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(record));
  }, [key, record]);
  return [record, setRecord] as const;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function timeOf(message: Message | null): number {
  return message ? Date.parse(message.sentAt) : 0;
}

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return timeOf(b.lastMessage) - timeOf(a.lastMessage);
  });
}

// swift drops nil fields instead of sending null, so clientId can be undefined
function sameMessage(a: Message, b: Message): boolean {
  return a.id === b.id || (a.clientId != null && a.clientId === b.clientId);
}

function upsertMessage(list: Message[], incoming: Message): Message[] {
  const idx = list.findIndex((m) => sameMessage(m, incoming));
  if (idx >= 0) {
    const next = [...list];
    next[idx] = incoming;
    return next;
  }
  return [...list, incoming];
}

function withLastMessage(list: Conversation[], message: Message): Conversation[] {
  return list.map((c) => {
    if (c.id !== message.conversationId) return c;
    const last = c.lastMessage;
    if (last && !sameMessage(last, message) && timeOf(last) > timeOf(message)) return c;
    return { ...c, lastMessage: message };
  });
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export function useRyMessageStore(bridge: RyMessageBridge) {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [messageErrors, setMessageErrors] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, "loading" | "done">>({});
  const historyRef = useRef(history);
  historyRef.current = history;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [pinOverrides, setPinOverrides] = usePersistedRecord<boolean>(PINS_KEY);
  const [readThrough, setReadThrough] = usePersistedRecord<string>(READ_KEY);
  const [hiddenThrough, setHiddenThrough] = usePersistedRecord<string>(HIDDEN_KEY);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const loadConversations = useCallback(() => {
    setLoadError(null);
    Promise.all([bridge.getCapabilities(), bridge.getConversations()]).then(
      ([caps, list]) => {
        setCapabilities(caps);
        setConversations(list);
      },
      (e) => setLoadError(errorMessage(e))
    );
  }, [bridge]);

  useEffect(() => {
    if (!loadError) return;
    const retry = window.setInterval(loadConversations, 15_000);
    return () => clearInterval(retry);
  }, [loadError, loadConversations]);

  const loadMessages = useCallback(
    (id: string) => {
      setMessageErrors((cur) => withoutKey(cur, id));
      bridge.getMessages(id, undefined, PAGE_SIZE).then(
        (newestFirst) => {
          const fetched = [...newestFirst].reverse();
          const oldestFetched = fetched.length ? timeOf(fetched[0]) : Infinity;
          setMessages((cur) => {
            const existing = cur[id] ?? [];
            const unseen = (m: Message) => !fetched.some((f) => sameMessage(f, m));
            // a reconnect refetch shouldn't throw away history that was already paged in
            const older = existing.filter(
              (m) => !m.id.startsWith("local-") && timeOf(m) < oldestFetched && unseen(m)
            );
            const pending = existing.filter((m) => m.id.startsWith("local-") && unseen(m));
            return { ...cur, [id]: [...older, ...fetched, ...pending] };
          });
          if (fetched.length === 0) setHistory((cur) => ({ ...cur, [id]: "done" }));
        },
        (e) => setMessageErrors((cur) => ({ ...cur, [id]: errorMessage(e) }))
      );
    },
    [bridge]
  );

  const loadOlder = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id || historyRef.current[id]) return;
    const oldest = messagesRef.current[id]?.find((m) => !m.id.startsWith("local-"));
    if (!oldest) return;
    historyRef.current = { ...historyRef.current, [id]: "loading" };
    setHistory((cur) => ({ ...cur, [id]: "loading" }));
    bridge.getMessages(id, oldest.id, PAGE_SIZE).then(
      (newestFirst) => {
        const page = [...newestFirst].reverse();
        setMessages((cur) => {
          const existing = cur[id] ?? [];
          const fresh = page.filter((m) => !existing.some((e) => sameMessage(e, m)));
          return { ...cur, [id]: [...fresh, ...existing] };
        });
        setHistory((cur) => (page.length === 0 ? { ...cur, [id]: "done" } : withoutKey(cur, id)));
      },
      (e) => {
        console.warn("Failed to load older messages", e);
        setHistory((cur) => withoutKey(cur, id));
      }
    );
  }, [bridge]);

  const markRead = useCallback(
    (id: string, through?: string) => {
      const until = through ?? conversationsRef.current?.find((c) => c.id === id)?.lastMessage?.sentAt;
      if (until) {
        setReadThrough((prev) =>
          prev[id] && Date.parse(prev[id]) >= Date.parse(until) ? prev : { ...prev, [id]: until }
        );
      }
      if (!capabilitiesRef.current?.markRead) return;
      setConversations((prev) => prev && prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
      bridge.markRead(id).catch((e) => console.warn("Failed to mark conversation read", e));
    },
    [bridge]
  );

  const applyMessage = useCallback((message: Message, overwriteConfirmed = true) => {
    setMessages((prev) => {
      const existing = prev[message.conversationId];
      if (!existing) return prev;
      if (
        !overwriteConfirmed &&
        existing.some((m) => sameMessage(m, message) && !m.id.startsWith("local-"))
      ) {
        return prev;
      }
      return { ...prev, [message.conversationId]: upsertMessage(existing, message) };
    });
    setConversations((prev) => prev && withLastMessage(prev, message));
  }, []);

  useEffect(() => {
    loadConversations();
    let wasOnline = false;
    const offStatus = bridge.onStatus((next) => {
      setStatus(next);
      if (next !== "online") return;
      if (wasOnline) {
        loadConversations();
        const id = selectedIdRef.current;
        setMessages((cur) => (id && cur[id] ? { [id]: cur[id] } : {}));
        if (id) loadMessages(id);
      }
      wasOnline = true;
    });
    const offEvents = bridge.subscribe((event) => {
      if (event.type === "contactsChanged") return;
      if (event.type === "conversationUpdated") {
        const incoming = event.conversation;
        setConversations((prev) => {
          if (!prev) return prev;
          return prev.some((c) => c.id === incoming.id)
            ? prev.map((c) => (c.id === incoming.id ? incoming : c))
            : [...prev, incoming];
        });
        return;
      }
      applyMessage(event.message);
      if (
        event.type === "messageCreated" &&
        !event.message.isFromMe &&
        event.message.conversationId === selectedIdRef.current
      ) {
        markRead(event.message.conversationId, event.message.sentAt);
      }
    });
    return () => {
      offStatus();
      offEvents();
    };
  }, [bridge, loadConversations, loadMessages, applyMessage, markRead]);

  const selectConversation = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (!messagesRef.current[id]) loadMessages(id);
      markRead(id);
    },
    [loadMessages, markRead]
  );

  const send = useCallback(
    (
      conversationId: string,
      text: string | null,
      attachments: Attachment[],
      replyTo: string | null,
      deliver: (clientId: string) => Promise<Message>
    ) => {
      const clientId = crypto.randomUUID();
      const optimistic: Message = {
        id: `local-${clientId}`,
        conversationId,
        sender: null,
        isFromMe: true,
        text,
        attachments,
        sentAt: new Date().toISOString(),
        deliveredAt: null,
        readAt: null,
        service:
          conversationsRef.current?.find((c) => c.id === conversationId)?.service ?? "iMessage",
        status: "sending",
        clientId,
        reactions: [],
        replyTo,
      };
      applyMessage(optimistic);
      deliver(clientId).then(
        (final) => {
          // a still-sending reply is a server placeholder; keep the local preview until the real record arrives
          if (final.status !== "sending") applyMessage(final, false);
        },
        () => applyMessage({ ...optimistic, status: "failed" }, false)
      );
    },
    [applyMessage]
  );

  const sendText = useCallback(
    (conversationId: string, text: string, replyTo: string | null) => {
      send(conversationId, text, [], replyTo, (clientId) =>
        bridge.sendMessage(conversationId, clientId, text, replyTo)
      );
    },
    [bridge, send]
  );

  const setReaction = useCallback(
    (message: Message, kind: TapbackKind | null) => {
      const others = message.reactions.filter((r) => !r.isFromMe);
      const optimistic: Message = {
        ...message,
        reactions: kind
          ? [...others, { kind, sender: null, isFromMe: true, sentAt: new Date().toISOString() }]
          : others,
      };
      applyMessage(optimistic);
      bridge
        .setReaction(message.conversationId, message.id, kind)
        .then(applyMessage, (e) => {
          console.warn("Failed to set tapback", e);
          applyMessage(message);
        });
    },
    [bridge, applyMessage]
  );

  const sendFile = useCallback(
    (conversationId: string, file: File) => {
      const preview: Attachment = {
        id: "local-preview",
        mimeType: file.type || "application/octet-stream",
        fileName: file.name,
        byteSize: file.size,
        width: null,
        height: null,
        url: URL.createObjectURL(file),
      };
      send(conversationId, null, [preview], null, (clientId) =>
        bridge.sendAttachment(conversationId, clientId, file)
      );
    },
    [bridge, send]
  );

  const startConversation = useCallback(
    async (to: string[], text: string): Promise<string> => {
      const message = await bridge.startConversation(crypto.randomUUID(), to, text);
      if (!conversationsRef.current?.some((c) => c.id === message.conversationId)) {
        setConversations(await bridge.getConversations());
      }
      return message.conversationId;
    },
    [bridge]
  );

  const retryLoadMessages = useCallback(() => {
    if (selectedIdRef.current) loadMessages(selectedIdRef.current);
  }, [loadMessages]);

  const togglePin = useCallback(
    (conversationId: string, currentlyPinned: boolean) => {
      setPinOverrides((prev) => ({ ...prev, [conversationId]: !currentlyPinned }));
    },
    [setPinOverrides]
  );

  const hideConversation = useCallback(
    (conversationId: string) => {
      const last = conversationsRef.current?.find((c) => c.id === conversationId)?.lastMessage;
      setHiddenThrough((prev) => ({ ...prev, [conversationId]: last?.sentAt ?? new Date().toISOString() }));
      if (selectedIdRef.current === conversationId) setSelectedId(null);
    },
    [setHiddenThrough]
  );

  // pins, read state, and deletions can't be written back to Messages, so they're kept on this PC
  const effectiveConversations = useMemo(() => {
    const coveredBy = (mark: string | undefined, c: Conversation) =>
      mark !== undefined && timeOf(c.lastMessage) <= Date.parse(mark);
    return sortConversations(
      (conversations ?? [])
        .filter((c) => !coveredBy(hiddenThrough[c.id], c))
        .map((c) => ({
          ...c,
          pinned: pinOverrides[c.id] ?? c.pinned,
          unreadCount: coveredBy(readThrough[c.id], c) ? 0 : c.unreadCount,
        }))
    );
  }, [conversations, pinOverrides, readThrough, hiddenThrough]);

  const selected = effectiveConversations.find((c) => c.id === selectedId) ?? null;

  // a conversation that's open is always read through its newest message
  useEffect(() => {
    const last = selected?.lastMessage;
    if (!selected || !last) return;
    const mark = readThrough[selected.id];
    if (mark !== undefined && Date.parse(mark) >= timeOf(last)) return;
    markRead(selected.id, last.sentAt);
  }, [selected, readThrough, markRead]);

  return {
    capabilities,
    conversations: effectiveConversations,
    conversationsLoading: conversations === null && loadError === null,
    loadError,
    retryLoad: loadConversations,
    messages,
    messageError: selectedId ? (messageErrors[selectedId] ?? null) : null,
    historyState: (selectedId && history[selectedId]) || ("idle" as const),
    loadOlder,
    retryLoadMessages,
    status,
    selected,
    selectConversation,
    sendText,
    sendFile,
    startConversation,
    setReaction,
    togglePin,
    hideConversation,
  };
}
