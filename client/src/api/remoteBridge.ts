import type { ConnectionStatus, RyMessageBridge } from "./bridge";
import type {
  Attachment,
  BridgeEvent,
  Capabilities,
  ContactsResponse,
  Conversation,
  Message,
  TapbackKind,
} from "./types";

const POLICY_VIOLATION = 1008;
const WATCHDOG_MS = 15_000;
const SLEEP_GAP_MS = 60_000;
const PING_STALE_MS = 20_000;
const PING_FRAME = '{"type":"ping"}';

export class RemoteBridge implements RyMessageBridge {
  private listeners = new Set<(event: BridgeEvent) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private status: ConnectionStatus = "connecting";
  private socket: WebSocket | null = null;
  private reconnectDelay = 1000;
  private reconnectTimer: number | null = null;
  private watchdog: number | null = null;
  private lastTickAt = 0;
  private pingSentAt = 0;

  constructor(
    private baseUrl: string,
    private token: string
  ) {}

  async getCapabilities(): Promise<Capabilities> {
    const body = await this.request<{ capabilities: Capabilities }>("GET", "/v1/capabilities");
    return body.capabilities;
  }

  getConversations(): Promise<Conversation[]> {
    return this.request("GET", "/v1/conversations");
  }

  getMessages(conversationId: string, before?: string, limit = 50): Promise<Message[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set("before", before);
    return this.request("GET", `/v1/conversations/${conversationId}/messages?${params}`);
  }

  sendMessage(
    conversationId: string,
    clientId: string,
    text: string,
    replyTo: string | null
  ): Promise<Message> {
    return this.request("POST", `/v1/conversations/${conversationId}/messages`, {
      clientId,
      text,
      ...(replyTo ? { replyTo } : {}),
    });
  }

  startConversation(clientId: string, to: string[], text: string): Promise<Message> {
    return this.request("POST", "/v1/messages", { clientId, to, text });
  }

  setReaction(conversationId: string, messageId: string, kind: TapbackKind | null): Promise<Message> {
    return this.request("POST", `/v1/conversations/${conversationId}/messages/${messageId}/reaction`, {
      kind,
    });
  }

  async sendAttachment(conversationId: string, clientId: string, file: File): Promise<Message> {
    const form = new FormData();
    form.set("clientId", clientId);
    form.set("file", file);
    const res = await fetch(`${this.baseUrl}/v1/conversations/${conversationId}/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    if (!res.ok) throw await this.toError(res);
    return res.json();
  }

  async markRead(conversationId: string): Promise<void> {
    await this.request("POST", `/v1/conversations/${conversationId}/read`);
  }

  getAttachment(attachment: Attachment): Promise<Blob> {
    return this.fetchBlob(attachment.url);
  }

  getContacts(version: string | null): Promise<ContactsResponse> {
    const query = version ? `?${new URLSearchParams({ version })}` : "";
    return this.request("GET", `/v1/contacts${query}`);
  }

  getAvatar(url: string): Promise<Blob> {
    return this.fetchBlob(url);
  }

  private async fetchBlob(path: string): Promise<Blob> {
    const url = path.startsWith("/") ? `${this.baseUrl}${path}` : path;
    if (new URL(url).origin !== new URL(this.baseUrl).origin) {
      throw new Error("Refusing to send the server token to a different host.");
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw await this.toError(res);
    return res.blob();
  }

  subscribe(listener: (event: BridgeEvent) => void): () => void {
    this.listeners.add(listener);
    this.startWatchdog();
    if (!this.socket && this.reconnectTimer === null && this.status !== "unauthorized") {
      this.connect();
    }
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  close(): void {
    if (this.watchdog !== null) {
      clearInterval(this.watchdog);
      this.watchdog = null;
      window.removeEventListener("online", this.onBackOnline);
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw await this.toError(res);
    if (res.status === 204) return undefined as T;
    return res.json();
  }

  private async toError(res: Response): Promise<Error> {
    try {
      const body = await res.json();
      return new Error(body.error?.message ?? `Request failed with ${res.status}`);
    } catch {
      return new Error(`Request failed with ${res.status}`);
    }
  }

  private onBackOnline = () => {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.dropSocket();
  };

  private startWatchdog() {
    if (this.watchdog !== null) return;
    this.lastTickAt = Date.now();
    this.watchdog = window.setInterval(() => this.checkSocket(), WATCHDOG_MS);
    window.addEventListener("online", this.onBackOnline);
  }

  // a half-dead socket never fires onclose, so we drop it and start fresh; the stale guard ignores its late close
  private dropSocket() {
    const socket = this.socket;
    this.socket = null;
    this.pingSentAt = 0;
    socket?.close();
    if (this.reconnectTimer === null) this.connect();
  }

  private checkSocket() {
    const now = Date.now();
    const slept = now - this.lastTickAt > SLEEP_GAP_MS;
    this.lastTickAt = now;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.pingSentAt = 0;
      return;
    }
    if (slept) {
      this.dropSocket();
      return;
    }
    if (this.pingSentAt !== 0) {
      if (socket.bufferedAmount === 0) {
        this.pingSentAt = 0;
      } else if (now - this.pingSentAt > PING_STALE_MS) {
        this.dropSocket();
        return;
      }
    }
    if (this.pingSentAt === 0) {
      socket.send(PING_FRAME);
      this.pingSentAt = now;
    }
  }

  private connect() {
    this.reconnectTimer = null;
    this.setStatus("connecting");
    this.pingSentAt = 0;
    const socket = new WebSocket(`${this.baseUrl.replace(/^http/, "ws")}/v1/events`);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "auth", token: this.token }));
      this.reconnectDelay = 1000;
      this.setStatus("online");
    };
    socket.onmessage = (raw) => {
      let event: BridgeEvent;
      try {
        event = JSON.parse(raw.data);
      } catch {
        console.warn("Ignoring malformed event frame");
        return;
      }
      for (const listener of this.listeners) listener(event);
    };
    // ignore stale sockets or we end up with two connections
    socket.onclose = (e) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (e.code === POLICY_VIOLATION) {
        this.setStatus("unauthorized");
        return;
      }
      this.setStatus("offline");
      this.reconnectTimer = window.setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    };
  }
}
