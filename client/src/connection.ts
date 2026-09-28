import type { RyMessageBridge } from "./api/bridge";
import { MockBridge } from "./api/mockBridge";
import { RemoteBridge } from "./api/remoteBridge";

export type Connection =
  | { mode: "demo" }
  | { mode: "remote"; url: string; token: string };

const STORAGE_KEY = "rymessage.connection";

export function loadConnection(): Connection | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.mode === "demo") return { mode: "demo" };
    if (parsed.mode === "remote" && typeof parsed.url === "string" && typeof parsed.token === "string") {
      return { mode: "remote", url: parsed.url, token: parsed.token };
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

export function saveConnection(connection: Connection): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
}

export function clearConnection(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function createBridge(connection: Connection): RyMessageBridge {
  if (connection.mode === "demo") return new MockBridge();
  return new RemoteBridge(connection.url, connection.token);
}

export function parsePairingCode(code: string): { url: string; token: string } {
  const trimmed = code.trim();
  if (!trimmed.startsWith("RYM1.")) {
    throw new Error("That doesn't look like a RyMessage pairing code.");
  }
  const base64 = trimmed.slice(5).replace(/-/g, "+").replace(/_/g, "/");
  let payload: unknown;
  try {
    payload = JSON.parse(atob(base64));
  } catch {
    throw new Error("Pairing code is malformed. Copy it exactly as the server printed it.");
  }
  const { u, t } = payload as { u?: unknown; t?: unknown };
  if (typeof u !== "string" || typeof t !== "string" || !u || !t) {
    throw new Error("Pairing code is missing the server address or token.");
  }
  return { url: u.replace(/\/+$/, ""), token: t };
}

export async function testConnection(url: string, token: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/+$/, "")}/v1/capabilities`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check that it's running and on the same network.");
  }
  if (res.status === 401) {
    throw new Error("The server rejected the token. Grab a fresh pairing code and try again.");
  }
  if (!res.ok) {
    throw new Error(`The server responded with an error (${res.status}).`);
  }
}
