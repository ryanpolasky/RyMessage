import { clearLegacyCustomSoundName, legacyCustomSoundName } from "./settings";

export interface CustomSound {
  id: string;
  name: string;
  blob: Blob;
  durationMs: number;
  createdAt: number;
}

const DB_NAME = "rymessage";
const STORE = "sounds";
const LEGACY_SOUND_KEY = "rymessage.customSound";

let database: Promise<IDBDatabase> | null = null;
let migration: Promise<string | null> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  database ??= openDatabase();
  return database.then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = action(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

export async function listSounds(): Promise<CustomSound[]> {
  const sounds = await run<CustomSound[]>("readonly", (store) => store.getAll());
  return sounds.sort((a, b) => a.createdAt - b.createdAt);
}

export function getSound(id: string): Promise<CustomSound | undefined> {
  return run<CustomSound | undefined>("readonly", (store) => store.get(id));
}

export async function putSound(sound: CustomSound): Promise<void> {
  await run("readwrite", (store) => store.put(sound));
}

export async function deleteSound(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
}

export function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || fileName;
}

// moves the old single localStorage sound into the library, once
export function migrateLegacySound(): Promise<string | null> {
  migration ??= (async () => {
    const dataUrl = localStorage.getItem(LEGACY_SOUND_KEY);
    if (!dataUrl) return null;
    const name = legacyCustomSoundName();
    const blob = await (await fetch(dataUrl)).blob();
    const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
    const id = crypto.randomUUID();
    await putSound({
      id,
      name: name ? stripExtension(name) : "Custom sound",
      blob,
      durationMs: Math.round(decoded.duration * 1000),
      createdAt: Date.now(),
    });
    localStorage.removeItem(LEGACY_SOUND_KEY);
    clearLegacyCustomSoundName();
    return id;
  })();
  return migration;
}
