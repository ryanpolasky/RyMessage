import type {
  Attachment,
  BridgeEvent,
  Capabilities,
  ContactsResponse,
  Conversation,
  Message,
  TapbackKind,
} from "./types";

export type ConnectionStatus = "connecting" | "online" | "offline" | "unauthorized";

export interface RyMessageBridge {
  getCapabilities(): Promise<Capabilities>;
  getConversations(): Promise<Conversation[]>;
  getMessages(conversationId: string, before?: string, limit?: number): Promise<Message[]>;
  sendMessage(
    conversationId: string,
    clientId: string,
    text: string,
    replyTo: string | null
  ): Promise<Message>;
  startConversation(clientId: string, to: string[], text: string): Promise<Message>;
  setReaction(conversationId: string, messageId: string, kind: TapbackKind | null): Promise<Message>;
  sendAttachment(conversationId: string, clientId: string, file: File): Promise<Message>;
  markRead(conversationId: string): Promise<void>;
  getAttachment(attachment: Attachment): Promise<Blob>;
  getContacts(version: string | null): Promise<ContactsResponse>;
  getAvatar(url: string): Promise<Blob>;
  subscribe(listener: (event: BridgeEvent) => void): () => void;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  close(): void;
}
