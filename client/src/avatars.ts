import { createContext, useContext, useEffect, useState } from "react";
import type { Participant } from "./api/types";

export type AvatarLoader = (url: string) => Promise<Blob>;

export const AvatarLoaderContext = createContext<AvatarLoader | null>(null);

const caches = new WeakMap<AvatarLoader, Map<string, Promise<string>>>();

function isInline(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("blob:");
}

function load(loader: AvatarLoader, url: string): Promise<string> {
  let cache = caches.get(loader);
  if (!cache) caches.set(loader, (cache = new Map()));
  let pending = cache.get(url);
  if (!pending) {
    pending = loader(url).then((blob) => URL.createObjectURL(blob));
    cache.set(url, pending);
    pending.catch(() => cache.delete(url));
  }
  return pending;
}

export function useAvatarSrc(url: string | null): string | null {
  const loader = useContext(AvatarLoaderContext);
  const [src, setSrc] = useState(() => (url && isInline(url) ? url : null));

  useEffect(() => {
    if (!url || isInline(url) || !loader) {
      setSrc(url && isInline(url) ? url : null);
      return;
    }
    let cancelled = false;
    load(loader, url).then(
      (objectUrl) => !cancelled && setSrc(objectUrl),
      () => !cancelled && setSrc(null)
    );
    return () => {
      cancelled = true;
    };
  }, [url, loader]);

  return src;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// the overlay window has no server connection, so photos travel inline
export async function withInlineAvatar(participant: Participant, loader: AvatarLoader): Promise<Participant> {
  const url = participant.avatarUrl;
  if (!url || isInline(url)) return participant;
  try {
    return { ...participant, avatarUrl: await blobToDataUrl(await loader(url)) };
  } catch {
    return { ...participant, avatarUrl: null };
  }
}
