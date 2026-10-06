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
    "markRead": true,
    "compose": true,
    "groupCompose": false,
    "contacts": true
  }
}
```

Clients must gate features on this response. Unsupported operations return `501` with an error body.

`reactions` and `replies` describe whether the client may send tapbacks and replies. Received reactions and reply references are always included on `Message` whenever the server can read them, regardless of these flags.

`compose` allows starting a conversation with one recipient; `groupCompose` allows more than one. `contacts` means `GET /v1/contacts` is available. Without it, clients build their directory from conversation participants.

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
  editedAt?: string | null;
  unsent?: boolean | null;
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

interface Contact {
  id: string;
  displayName: string;
  handles: string[];
  avatarUrl: string | null;
}
```

`Participant.avatarUrl` and `Contact.avatarUrl` are relative paths such as `/v1/avatars/<contactId>?v=<hash>`. Like attachments they require the bearer token. The `v` parameter changes whenever the photo changes, so clients can cache by URL indefinitely.

`Contact.handles` holds phone numbers in E.164 form and lowercase email addresses.

`clientId` echoes the client-generated id supplied at send time so optimistic messages can be reconciled with their final records.

`reactions` holds at most one tapback per participant, matching iMessage. `replyTo` is the id of the message this one replies to (the thread originator), or `null`.

`editedAt` is when the message was last edited, and is absent or `null` for messages that were never edited. `text` always holds the latest version.

`unsent` is `true` when the sender unsent the message. Its `text`, `attachments`, and `reactions` are then empty, and clients show a placeholder in its place.

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

A server that hands sends to another app may not have the final record yet. It then returns a placeholder with `status: "sending"`, and the final record arrives later as `messageCreated` with the same `clientId` and its own `id`. If the final record never arrives, the placeholder is sent again as `messageUpdated` with `status: "failed"`. Clients match all of these by `clientId`.

### POST /v1/messages

```json
{ "clientId": "uuid", "to": ["+15551230002"], "text": "hello" }
```

Starts a conversation, or reuses the existing one with exactly these recipients, and sends the first message. `to` accepts phone numbers and email addresses. Requires `compose`, and `groupCompose` when `to` has more than one entry. Returns the created `Message`; its `conversationId` identifies the conversation. The server broadcasts `conversationUpdated` before `messageCreated` when a conversation is new.

### GET /v1/contacts?version=<version>

```json
{ "version": "b1946ac9", "contacts": [ ] }
```

Returns the full contact list and an opaque `version`. When the request's `version` matches the current one, `contacts` is `null` (or omitted) and clients keep their cached copy. Requires `contacts`.

### GET /v1/avatars/:contactId

Streams the contact's photo thumbnail. Requires authentication. Responses carry `Cache-Control: private, max-age=31536000, immutable`.

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
{ "type": "contactsChanged", "version": "b1946ac9" }
```

`contactsChanged` fires when the Mac's Contacts change; clients refetch `GET /v1/contacts` with their cached version.

`messageUpdated` fires on delivery/read status changes, tapback changes, edits, unsends, and on reconciliation of optimistic sends (matched via `clientId`).

Events are not replayed. Clients must refetch conversations and any open message history after a reconnect.

## Errors

```json
{ "error": { "code": "not_supported", "message": "Reactions are not supported by this server." } }
```

Codes: `unauthorized`, `not_found`, `not_supported`, `send_failed`, `invalid_request`, `permission_required`, `internal`.

`permission_required` (HTTP 503) means the server is running but the host OS hasn't granted it access yet; the message says what to enable.
