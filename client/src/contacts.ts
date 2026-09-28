import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionStatus, RyMessageBridge } from "./api/bridge";
import type { Contact, Conversation } from "./api/types";
import { normalizeHandle } from "./utils/handles";

export interface DirectoryEntry {
  id: string;
  displayName: string | null;
  handles: string[];
  avatarUrl: string | null;
}

interface ContactsCache {
  version: string;
  contacts: Contact[];
}

function loadCache(key: string): ContactsCache | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

export function useDirectory(
  bridge: RyMessageBridge,
  cacheKey: string,
  canSync: boolean,
  status: ConnectionStatus,
  conversations: Conversation[]
): DirectoryEntry[] {
  const storageKey = `rymessage.contacts.${cacheKey}`;
  const [cache, setCache] = useState(() => loadCache(storageKey));
  const versionRef = useRef(cache?.version ?? null);

  const sync = useCallback(() => {
    bridge.getContacts(versionRef.current).then(
      (res) => {
        if (res.contacts == null) return;
        const next = { version: res.version, contacts: res.contacts };
        versionRef.current = res.version;
        setCache(next);
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch (e) {
          console.warn("Couldn't cache contacts locally", e);
        }
      },
      (e) => console.warn("Failed to sync contacts", e)
    );
  }, [bridge, storageKey]);

  useEffect(() => {
    if (canSync && status === "online") sync();
  }, [canSync, status, sync]);

  useEffect(() => {
    if (!canSync) return;
    return bridge.subscribe((event) => {
      if (event.type === "contactsChanged" && event.version !== versionRef.current) sync();
    });
  }, [bridge, canSync, sync]);

  return useMemo(() => {
    const entries: DirectoryEntry[] = canSync ? [...(cache?.contacts ?? [])] : [];
    const seen = new Set(entries.flatMap((e) => e.handles.map(normalizeHandle)));
    for (const convo of conversations) {
      for (const p of convo.participants) {
        const key = normalizeHandle(p.handle);
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          id: `participant-${p.id}`,
          displayName: p.displayName,
          handles: [p.handle],
          avatarUrl: p.avatarUrl,
        });
      }
    }
    return entries;
  }, [cache, canSync, conversations]);
}
