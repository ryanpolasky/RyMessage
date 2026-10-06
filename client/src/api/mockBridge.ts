import { normalizeHandle } from "../utils/handles";
import type { ConnectionStatus, RyMessageBridge } from "./bridge";
import type {
  Attachment,
  BridgeEvent,
  Capabilities,
  Contact,
  ContactsResponse,
  Conversation,
  Message,
  Participant,
  Service,
  TapbackKind,
} from "./types";

const capabilities: Capabilities = {
  sendText: true,
  attachments: true,
  reactions: true,
  replies: true,
  editing: false,
  unsend: false,
  typingIndicators: false,
  markRead: true,
  compose: true,
  groupCompose: false,
  contacts: true,
};

function portrait(bg: [string, string], skin: string, hair: string, shirt: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><ellipse cx="50" cy="106" rx="38" ry="32" fill="${shirt}"/><circle cx="50" cy="45" r="19" fill="${skin}"/><path d="M30 44c0-15 9-24 20-24s20 9 20 24c-4-8-11-11-20-11s-16 3-20 11z" fill="${hair}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function person(id: string, name: string, handle: string, avatarUrl: string | null = null): Participant {
  return { id, displayName: name, handle, avatarUrl };
}

const mom = person("p-mom", "Mom", "+15551230001", portrait(["#f6b1c3", "#e9798f"], "#f1c7a5", "#6b4a3a", "#fff3f6"));
const alex = person("p-alex", "Alex Chen", "+15551230002", portrait(["#9ad0ff", "#4b8fe0"], "#e8b98f", "#1f1f1f", "#243b6b"));
const sam = person("p-sam", "Sam Rivera", "+15551230003", portrait(["#b9f2c9", "#44b37a"], "#c68b62", "#2b1d14", "#f5f5f5"));
const jordan = person("p-jordan", "Jordan Lee", "+15551230004");
const dylan = person("p-dylan", "Dylan Park", "dylan.park@icloud.com");
const casey = person("p-casey", "Casey Morgan", "+15551230005", portrait(["#ffd9a0", "#f0a04b"], "#f3d2b5", "#b5651d", "#3a3a3a"));
const shortCode: Participant = { id: "p-46001", displayName: null, handle: "46001", avatarUrl: null };

const CONTACTS_VERSION = "demo-1";

const contacts: Contact[] = [
  ...[mom, alex, sam, jordan, dylan, casey].map((p) => ({
    id: `contact-${p.id}`,
    displayName: p.displayName!,
    handles: [p.handle],
    avatarUrl: p.avatarUrl,
  })),
  {
    id: "contact-priya",
    displayName: "Priya Shah",
    handles: ["+15551230006"],
    avatarUrl: portrait(["#d6c4ff", "#8a6be0"], "#b07a55", "#1a1210", "#ffe08a"),
  },
  {
    id: "contact-marcus",
    displayName: "Marcus Webb",
    handles: ["marcus.webb@icloud.com", "+15551230007"],
    avatarUrl: null,
  },
  { id: "contact-nina", displayName: "Nina Alvarez", handles: ["+15551230008"], avatarUrl: null },
];

let messageCounter = 0;

function minutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

function msg(
  conversationId: string,
  sender: Participant | null,
  text: string,
  minsAgo: number,
  read = true,
  service: Service = "iMessage"
): Message {
  messageCounter += 1;
  const fromMe = sender === null;
  return {
    id: `m-${messageCounter}`,
    conversationId,
    sender,
    isFromMe: fromMe,
    text,
    attachments: [],
    sentAt: minutesAgo(minsAgo),
    deliveredAt: minutesAgo(minsAgo),
    readAt: read ? minutesAgo(minsAgo - 1) : null,
    service,
    status: fromMe ? (read ? "read" : "delivered") : "sent",
    clientId: null,
    reactions: [],
    replyTo: null,
  };
}

function react(message: Message, kind: TapbackKind, sender: Participant | null, minsAgo: number) {
  message.reactions.push({ kind, sender, isFromMe: sender === null, sentAt: minutesAgo(minsAgo) });
}

const history: Record<string, Message[]> = {
  "c-mom": [
    msg("c-mom", mom, "Did you land safely?", 220),
    msg("c-mom", null, "Yep, just got to the hotel", 218),
    msg("c-mom", mom, "Good! Call me tomorrow", 215),
    msg("c-mom", null, "Will do, night!", 214),
    msg("c-mom", mom, "Don't forget Sunday dinner this week", 30),
  ],
  "c-alex": [
    msg("c-alex", alex, "yo did you see the game last night", 1500),
    msg("c-alex", null, "unreal ending lol", 1495),
    msg("c-alex", alex, "we should go to one this season", 1490),
    msg("c-alex", null, "down, check the schedule", 1480),
    msg("c-alex", alex, "tickets for the 14th are like $60", 55),
    msg("c-alex", null, "say less, grab two", 50, false),
  ],
  "c-group": [
    msg("c-group", sam, "who's in for trivia thursday", 300),
    msg("c-group", jordan, "in", 295),
    msg("c-group", null, "in, same team name as last time?", 290),
    msg("c-group", sam, "obviously", 288),
    msg("c-group", jordan, "we got robbed last week btw", 285),
    msg("c-group", sam, "the answer WAS mercury", 284),
    msg("c-group", jordan, "it was venus sam", 12),
  ],
  "c-dylan": [
    msg("c-dylan", dylan, "PR is up when you get a sec", 2800),
    msg("c-dylan", null, "looking now", 2790),
    msg("c-dylan", null, "left two comments, otherwise lgtm", 2760),
    msg("c-dylan", dylan, "fixed, merging", 2700),
  ],
  "c-casey": [
    msg("c-casey", casey, "are you still coming saturday?", 4000, true, "SMS"),
    msg("c-casey", null, "yeah! what time", 3990, false, "SMS"),
    msg("c-casey", casey, "7ish, bring chips", 3985, true, "SMS"),
    msg("c-casey", null, "on it", 3980, false, "SMS"),
  ],
  "c-46001": [
    msg("c-46001", shortCode, "Your RyMessage verification code is 204 118. Don't share it with anyone.", 2900, true, "SMS"),
  ],
};

react(history["c-mom"][1], "love", mom, 217);
react(history["c-alex"][5], "like", alex, 49);
const group = history["c-group"];
react(group[5], "question", jordan, 283);
react(group[5], "laugh", null, 283);
react(group[6], "dislike", sam, 11);
const robbedReply = msg("c-group", null, "we absolutely got robbed", 283);
robbedReply.replyTo = group[4].id;
const riggedReply = msg("c-group", null, "the mercury question was rigged anyway", 282);
riggedReply.replyTo = group[4].id;
group.splice(6, 0, robbedReply, riggedReply);

const momHistory = history["c-mom"];
const gladReply = msg("c-mom", mom, "So glad you made it", 213);
gladReply.replyTo = momHistory[1].id;
const restReply = msg("c-mom", mom, "Get some rest!", 212);
restReply.replyTo = momHistory[1].id;
momHistory.splice(4, 0, gladReply, restReply);

history["c-alex"].push(msg("c-alex", alex, "🔥🔥🔥", 48), msg("c-alex", null, "🤝", 47));

const SUNSET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3a8c"/><stop offset=".55" stop-color="#f0708a"/><stop offset="1" stop-color="#ffc36b"/></linearGradient><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2697f"/><stop offset="1" stop-color="#1f2a66"/></linearGradient></defs><rect width="600" height="260" fill="url(#s)"/><circle cx="300" cy="250" r="70" fill="#ffe08a"/><rect y="250" width="600" height="150" fill="url(#w)"/><g fill="#ffe7a8" opacity=".7"><rect x="250" y="270" width="100" height="4" rx="2"/><rect x="265" y="290" width="70" height="4" rx="2"/><rect x="280" y="310" width="40" height="3" rx="1.5"/></g></svg>`;
const sunset = msg("c-mom", mom, "", 25);
sunset.text = null;
sunset.attachments = [
  {
    id: "a-sunset",
    mimeType: "image/svg+xml",
    fileName: "sunset.svg",
    byteSize: SUNSET_SVG.length,
    width: 600,
    height: 400,
    url: `data:image/svg+xml,${encodeURIComponent(SUNSET_SVG)}`,
  },
];
history["c-mom"].push(sunset);

const conversations: Conversation[] = [
  {
    id: "c-mom",
    displayName: "Mom",
    participants: [mom],
    isGroup: false,
    lastMessage: null,
    unreadCount: 1,
    service: "iMessage",
    pinned: true,
  },
  {
    id: "c-alex",
    displayName: "Alex Chen",
    participants: [alex],
    isGroup: false,
    lastMessage: null,
    unreadCount: 0,
    service: "iMessage",
    pinned: false,
  },
  {
    id: "c-group",
    displayName: "Trivia Squad",
    participants: [sam, jordan],
    isGroup: true,
    lastMessage: null,
    unreadCount: 2,
    service: "iMessage",
    pinned: false,
  },
  {
    id: "c-dylan",
    displayName: "Dylan Park",
    participants: [dylan],
    isGroup: false,
    lastMessage: null,
    unreadCount: 0,
    service: "iMessage",
    pinned: false,
  },
  {
    id: "c-casey",
    displayName: "Casey Morgan",
    participants: [casey],
    isGroup: false,
    lastMessage: null,
    unreadCount: 0,
    service: "SMS",
    pinned: false,
  },
  {
    id: "c-46001",
    displayName: null,
    participants: [shortCode],
    isGroup: false,
    lastMessage: null,
    unreadCount: 0,
    service: "SMS",
    pinned: false,
  },
];

for (const convo of conversations) {
  const msgs = history[convo.id];
  convo.lastMessage = msgs[msgs.length - 1];
}

const replies: Record<string, string[]> = {
  "c-mom": ["Okay sweetie", "Love you!", "See you Sunday"],
  "c-alex": ["got em", "lets gooo", "section 114, decent seats"],
  "c-group": ["ok fine it was venus", "trivia at 7 dont be late", "sam is buying first round"],
  "c-dylan": ["nice", "shipping it now", "ci is green"],
  "c-casey": ["perfect", "salsa too if you can", "see you then"],
};

const ambient: { conversationId: string; from: Participant; text: string; editTo?: string; unsend?: boolean }[] = [
  {
    conversationId: "c-alex",
    from: alex,
    text: "yo are you wathcing this",
    editTo: "yo are you watching this",
  },
  { conversationId: "c-group", from: sam, text: "wait wrong chat lol", unsend: true },
  {
    conversationId: "c-46001",
    from: shortCode,
    text: "Your RyMessage verification code is 482913. It expires in 10 minutes.",
  },
  { conversationId: "c-mom", from: mom, text: "Did you eat today?" },
  { conversationId: "c-group", from: sam, text: "new trivia category just dropped: 90s movies" },
  { conversationId: "c-casey", from: casey, text: "running like 10 min late" },
  { conversationId: "c-group", from: jordan, text: "im bringing snacks" },
  { conversationId: "c-dylan", from: dylan, text: "can you look at the flaky test when you get a sec" },
  { conversationId: "c-alex", from: alex, text: "ok that call was insane" },
  { conversationId: "c-mom", from: mom, text: "Call your grandma this weekend, she misses you" },
  { conversationId: "c-alex", from: alex, text: "we're still on for the 14th right" },
];

let ambientIndex = 0;

function serviceOf(conversationId: string): Service {
  return conversations.find((c) => c.id === conversationId)?.service ?? "iMessage";
}

let replyIndex = 0;

export class MockBridge implements RyMessageBridge {
  private listeners = new Set<(event: BridgeEvent) => void>();
  private ambientTimer: number | null = null;

  constructor(private ambientDelayMs: [number, number] = [20_000, 40_000]) {}

  async getCapabilities(): Promise<Capabilities> {
    return capabilities;
  }

  async getConversations(): Promise<Conversation[]> {
    await delay(120);
    return conversations.map((c) => ({ ...c }));
  }

  async getMessages(conversationId: string, before?: string, limit = 50): Promise<Message[]> {
    await delay(80);
    const msgs = history[conversationId] ?? [];
    let end = msgs.length;
    if (before) {
      const idx = msgs.findIndex((m) => m.id === before);
      if (idx >= 0) end = idx;
    }
    return msgs.slice(Math.max(0, end - limit), end).reverse();
  }

  async sendMessage(
    conversationId: string,
    clientId: string,
    text: string,
    replyTo: string | null
  ): Promise<Message> {
    await delay(150);
    messageCounter += 1;
    const message: Message = {
      id: `m-${messageCounter}`,
      conversationId,
      sender: null,
      isFromMe: true,
      text,
      attachments: [],
      sentAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
      service: serviceOf(conversationId),
      status: "sent",
      clientId,
      reactions: [],
      replyTo,
    };
    this.recordSent(message);
    this.simulateReply(message);
    return message;
  }

  async startConversation(clientId: string, to: string[], text: string): Promise<Message> {
    await delay(200);
    if (to.length !== 1) throw new Error("New group chats aren't supported by this server.");
    const key = normalizeHandle(to[0]);
    let convo = conversations.find(
      (c) => !c.isGroup && normalizeHandle(c.participants[0].handle) === key
    );
    if (!convo) {
      const known = contacts.find((c) => c.handles.some((h) => normalizeHandle(h) === key));
      const participant: Participant = {
        id: `p-${key}`,
        displayName: known?.displayName ?? null,
        handle: known?.handles.find((h) => normalizeHandle(h) === key) ?? to[0].trim(),
        avatarUrl: known?.avatarUrl ?? null,
      };
      convo = {
        id: `c-${key}`,
        displayName: known?.displayName ?? null,
        participants: [participant],
        isGroup: false,
        lastMessage: null,
        unreadCount: 0,
        service: "iMessage",
        pinned: false,
      };
      conversations.push(convo);
      history[convo.id] = [];
      this.emit({ type: "conversationUpdated", conversation: { ...convo } });
    }
    return this.sendMessage(convo.id, clientId, text, null);
  }

  async getContacts(version: string | null): Promise<ContactsResponse> {
    await delay(100);
    return {
      version: CONTACTS_VERSION,
      contacts: version === CONTACTS_VERSION ? null : contacts.map((c) => ({ ...c })),
    };
  }

  async getAvatar(url: string): Promise<Blob> {
    const res = await fetch(url);
    return res.blob();
  }

  async setReaction(
    conversationId: string,
    messageId: string,
    kind: TapbackKind | null
  ): Promise<Message> {
    await delay(120);
    const message = history[conversationId]?.find((m) => m.id === messageId);
    if (!message) throw new Error("Message not found.");
    this.applyReaction(message, kind, null);
    return { ...message };
  }

  async sendAttachment(conversationId: string, clientId: string, file: File): Promise<Message> {
    await delay(300);
    messageCounter += 1;
    const url = URL.createObjectURL(file);
    const message: Message = {
      id: `m-${messageCounter}`,
      conversationId,
      sender: null,
      isFromMe: true,
      text: null,
      attachments: [
        {
          id: `a-${messageCounter}`,
          mimeType: file.type,
          fileName: file.name,
          byteSize: file.size,
          width: null,
          height: null,
          url,
        },
      ],
      sentAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
      service: serviceOf(conversationId),
      status: "sent",
      clientId,
      reactions: [],
      replyTo: null,
    };
    this.recordSent(message);
    return message;
  }

  async markRead(conversationId: string): Promise<void> {
    const convo = conversations.find((c) => c.id === conversationId);
    if (convo && convo.unreadCount > 0) {
      convo.unreadCount = 0;
      this.emit({ type: "conversationUpdated", conversation: { ...convo } });
    }
  }

  async getAttachment(attachment: Attachment): Promise<Blob> {
    const res = await fetch(attachment.url);
    return res.blob();
  }

  subscribe(listener: (event: BridgeEvent) => void): () => void {
    this.listeners.add(listener);
    if (this.ambientTimer === null) this.scheduleAmbient();
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    listener("online");
    return () => {};
  }

  close(): void {
    this.listeners.clear();
    if (this.ambientTimer !== null) clearTimeout(this.ambientTimer);
    this.ambientTimer = null;
  }

  private scheduleAmbient() {
    const [min, max] = this.ambientDelayMs;
    this.ambientTimer = window.setTimeout(() => {
      const { conversationId, from, text, editTo, unsend } = ambient[ambientIndex % ambient.length];
      ambientIndex += 1;
      messageCounter += 1;
      const message: Message = {
        id: `m-${messageCounter}`,
        conversationId,
        sender: from,
        isFromMe: false,
        text,
        attachments: [],
        sentAt: new Date().toISOString(),
        deliveredAt: null,
        readAt: null,
        service: serviceOf(conversationId),
        status: "sent",
        clientId: null,
        reactions: [],
        replyTo: null,
      };
      history[conversationId]?.push(message);
      const convo = conversations.find((c) => c.id === conversationId);
      if (convo) convo.unreadCount += 1;
      this.emit({ type: "messageCreated", message: { ...message } });
      this.touchConversation(conversationId, message);
      if (editTo || unsend) {
        setTimeout(() => {
          if (unsend) {
            message.text = null;
            message.unsent = true;
          } else {
            message.text = editTo!;
            message.editedAt = new Date().toISOString();
          }
          this.emit({ type: "messageUpdated", message: { ...message } });
        }, 3000);
      }
      this.scheduleAmbient();
    }, min + Math.random() * (max - min));
  }

  private emit(event: BridgeEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private recordSent(message: Message) {
    history[message.conversationId]?.push(message);
    this.emit({ type: "messageCreated", message: { ...message } });
    this.touchConversation(message.conversationId, message);
    this.simulateDelivery(message);
  }

  private touchConversation(conversationId: string, message: Message) {
    const convo = conversations.find((c) => c.id === conversationId);
    if (!convo) return;
    convo.lastMessage = message;
    this.emit({ type: "conversationUpdated", conversation: { ...convo } });
  }

  private simulateDelivery(message: Message) {
    setTimeout(() => {
      message.status = "delivered";
      message.deliveredAt = new Date().toISOString();
      this.emit({ type: "messageUpdated", message: { ...message } });
    }, 900);
  }

  private applyReaction(message: Message, kind: TapbackKind | null, sender: Participant | null) {
    const others = message.reactions.filter((r) => (r.sender?.id ?? null) !== (sender?.id ?? null));
    message.reactions = kind
      ? [...others, { kind, sender, isFromMe: sender === null, sentAt: new Date().toISOString() }]
      : others;
    this.emit({ type: "messageUpdated", message: { ...message } });
  }

  private simulateReply(sent: Message) {
    const conversationId = sent.conversationId;
    const pool = replies[conversationId];
    if (!pool) return;
    const text = pool[replyIndex % pool.length];
    const convo = conversations.find((c) => c.id === conversationId);
    const sender = convo?.participants[0] ?? null;
    if (replyIndex % 3 === 1) {
      setTimeout(() => this.applyReaction(sent, "love", sender), 1500);
    }
    replyIndex += 1;
    setTimeout(() => {
      messageCounter += 1;
      const message: Message = {
        id: `m-${messageCounter}`,
        conversationId,
        sender,
        isFromMe: false,
        text,
        attachments: [],
        sentAt: new Date().toISOString(),
        deliveredAt: null,
        readAt: null,
        service: serviceOf(conversationId),
        status: "sent",
        clientId: null,
        reactions: [],
        replyTo: null,
      };
      history[conversationId]?.push(message);
      this.emit({ type: "messageCreated", message: { ...message } });
      this.touchConversation(conversationId, message);
    }, 2500 + Math.random() * 2000);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
