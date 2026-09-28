export interface Capabilities {
  sendText: boolean;
  attachments: boolean;
  reactions: boolean;
  replies: boolean;
  editing: boolean;
  unsend: boolean;
  typingIndicators: boolean;
  markRead: boolean;
}

export type Service = "iMessage" | "SMS";

export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export interface Participant {
  id: string;
  displayName: string | null;
  handle: string;
  avatarUrl: string | null;
}

export interface Attachment {
  id: string;
  mimeType: string;
  fileName: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  url: string;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: Participant | null;
  isFromMe: boolean;
  text: string | null;
  attachments: Attachment[];
  sentAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  service: Service;
  status: MessageStatus;
  clientId: string | null;
  reactions: Reaction[];
  replyTo: string | null;
}

export type TapbackKind = "love" | "like" | "dislike" | "laugh" | "emphasize" | "question";

export interface Reaction {
  kind: TapbackKind;
  sender: Participant | null;
  isFromMe: boolean;
  sentAt: string;
}

export interface Conversation {
  id: string;
  displayName: string | null;
  participants: Participant[];
  isGroup: boolean;
  lastMessage: Message | null;
  unreadCount: number;
  service: Service;
  pinned: boolean;
}

export type BridgeEvent =
  | { type: "messageCreated"; message: Message }
  | { type: "messageUpdated"; message: Message }
  | { type: "conversationUpdated"; conversation: Conversation };
