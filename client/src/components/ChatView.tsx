import { useState } from "react";
import type { Attachment, Capabilities, Conversation, Message, TapbackKind } from "../api/types";
import { attachmentLabel } from "../utils/attachments";
import { ConversationAvatar } from "./Avatar";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

interface ChatViewProps {
  conversation: Conversation;
  messages: Message[] | undefined;
  messageError: string | null;
  capabilities: Capabilities | null;
  loadAttachment: (attachment: Attachment) => Promise<Blob>;
  onRetry: () => void;
  onSendText: (text: string, replyTo: string | null) => void;
  onSendFile: (file: File) => void;
  onReact: (message: Message, kind: TapbackKind | null) => void;
}

export function ChatView({
  conversation,
  messages,
  messageError,
  capabilities,
  loadAttachment,
  onRetry,
  onSendText,
  onSendFile,
  onReact,
}: ChatViewProps) {
  const [reply, setReply] = useState<{ conversationId: string; message: Message } | null>(null);
  const replyingTo = reply?.conversationId === conversation.id ? reply.message : null;

  const title =
    conversation.displayName ??
    conversation.participants.map((p) => p.displayName ?? p.handle).join(", ");
  const replyName = replyingTo?.isFromMe
    ? "Yourself"
    : (replyingTo?.sender?.displayName ?? replyingTo?.sender?.handle ?? title);

  return (
    <section className="chat-view">
      <header className="chat-header">
        <ConversationAvatar conversation={conversation} size={36} />
        <span className="chat-header-name">{title}</span>
        {conversation.isGroup && (
          <span className="chat-header-sub">{conversation.participants.length + 1} people</span>
        )}
      </header>
      {messages ? (
        <MessageList
          conversation={conversation}
          messages={messages}
          capabilities={capabilities}
          loadAttachment={loadAttachment}
          onReact={onReact}
          onReply={(message) => setReply({ conversationId: conversation.id, message })}
        />
      ) : messageError ? (
        <div className="message-list loading">
          <div className="load-error">
            <span>Couldn't load messages.</span>
            <span className="load-error-detail">{messageError}</span>
            <button className="link-button" onClick={onRetry}>
              Try Again
            </button>
          </div>
        </div>
      ) : (
        <div className="message-list loading">
          <div className="loading-spinner" />
        </div>
      )}
      {replyingTo && (
        <div className="reply-banner">
          <div className="reply-banner-text">
            <span className="reply-banner-label">Replying to {replyName}</span>
            <span className="reply-banner-quote">
              {replyingTo.text ?? (replyingTo.attachments[0] ? attachmentLabel(replyingTo.attachments[0]) : "")}
            </span>
          </div>
          <button className="reply-banner-close" onClick={() => setReply(null)} title="Cancel Reply">
            <svg viewBox="0 0 16 16" width="10" height="10">
              <path
                d="M3.5 3.5l9 9m0-9l-9 9"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}
      <Composer
        conversationId={conversation.id}
        service={conversation.service}
        ready={messages !== undefined}
        canSendText={capabilities?.sendText ?? false}
        canAttach={capabilities?.attachments ?? false}
        replyTargetId={replyingTo?.id ?? null}
        onCancelReply={() => setReply(null)}
        onSendText={(text) => {
          onSendText(text, replyingTo?.id ?? null);
          setReply(null);
        }}
        onSendFile={onSendFile}
      />
    </section>
  );
}
