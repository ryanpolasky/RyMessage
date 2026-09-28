# RyMessage API Contract

The server exposes an authenticated HTTP API for commands and initial data, plus a WebSocket for real-time events. All payloads are JSON. All timestamps are ISO 8601 strings in UTC.

## Authentication

Every HTTP request requires a bearer token:

```
Authorization: Bearer <token>
```

Unauthenticated requests receive `401`.

WebSocket clients that can set headers use the same `Authorization` header. Browser clients cannot, so they must send an auth message as the first frame after connecting:

```json
{ "type": "auth", "token": "<token>" }
```

The server closes the socket with code `1008` (policy violation) if the first message is not a valid auth frame or if none arrives within 10 seconds. Tokens must never appear in URLs, where intermediaries can log them.

## Capability Discovery

### GET /v1/capabilities

```json
{
  "capabilities": {
    "sendText": true,
    "attachments": true,
    "reactions": false,
    "replies": false,
    "editing": false,
    "unsend": false,
    "typingIndicators": false,
    "markRead": true
  }
}
```

Clients must gate features on this response. Unsupported operations return `501` with an error body.

`reactions` and `replies` describe whether the client may send tapbacks and replies. Received reactions and reply references are always included on `Message` whenever the server can read them, regardless of these flags.

## Types

```ts
interface Conversation {
  id: string;
  displayName: string | null;
  participants: Participant[];
  isGroup: boolean;
  lastMessage: Message | null;
  unreadCount: number;
  service: "iMessage" | "SMS";
  pinned: boolean;
}

interface Participant {
  id: string;
  displayName: string | null;
  handle: string;
  avatarUrl: string | null;
}

interface Message {
  id: string;
  conversationId: string;
  sender: Participant | null;
  isFromMe: boolean;
  text: string | null;
  attachments: Attachment[];
  sentAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  service: "iMessage" | "SMS";
  status: "sending" | "sent" | "delivered" | "read" | "failed";
  clientId: string | null;
  reactions: Reaction[];
  replyTo: string | null;
}

type TapbackKind = "love" | "like" | "dislike" | "laugh" | "emphasize" | "question";

interface Reaction {
  kind: TapbackKind;
  sender: Participant | null;
  isFromMe: boolean;
  sentAt: string;
}

interface Attachment {
  id: string;
  mimeType: string;
  fileName: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  url: string;
}
```

`clientId` echoes the client-generated id supplied at send time so optimistic messages can be reconciled with their final records.

`reactions` holds at most one tapback per participant, matching iMessage. `replyTo` is the id of the message this one replies to (the thread originator), or `null`.

`Attachment.url` is a path relative to the server base URL, e.g. `/v1/attachments/<id>`. It requires the bearer token, so clients must fetch it with the `Authorization` header rather than linking it directly (an `<img src>` cannot authenticate).

## Endpoints

### GET /v1/conversations

Returns `Conversation[]` sorted by most recent activity.

### GET /v1/conversations/:id/messages?before=<messageId>&limit=<n>

Returns `Message[]` newest-first. `before` pages older history. Default limit 50.

### POST /v1/conversations/:id/messages

```json
{ "clientId": "uuid", "text": "hello", "replyTo": "messageId" }
```

`replyTo` is optional and requires the `replies` capability. Returns the created `Message` with `status: "sending"` or later.

### POST /v1/conversations/:id/messages/:messageId/reaction

```json
{ "kind": "love" }
```

Sets the current user's tapback on a message, replacing any previous one. `{ "kind": null }` removes it. Requires the `reactions` capability. Returns the updated `Message` and broadcasts `messageUpdated`.

### POST /v1/conversations/:id/attachments

Multipart form upload with fields `clientId` and `file`. Returns the created `Message`.

### POST /v1/conversations/:id/read

Marks the conversation read. Returns `204`.

### GET /v1/attachments/:id

Streams the attachment bytes. Requires authentication. Attachments are immutable, so responses carry `Cache-Control: private, max-age=31536000, immutable`.

## WebSocket Events

### WS /v1/events

Server pushes:

```json
{ "type": "messageCreated", "message": { } }
{ "type": "messageUpdated", "message": { } }
{ "type": "conversationUpdated", "conversation": { } }
```

`messageUpdated` fires on delivery/read status changes, tapback changes, and on reconciliation of optimistic sends (matched via `clientId`).

Events are not replayed. Clients must refetch conversations and any open message history after a reconnect.

## Errors

```json
{ "error": { "code": "not_supported", "message": "Reactions are not supported by this server." } }
```

Codes: `unauthorized`, `not_found`, `not_supported`, `send_failed`, `invalid_request`, `internal`.
