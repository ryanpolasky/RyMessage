import type { DragEvent } from "react";
import { useRef, useState } from "react";
import type { Attachment, Capabilities, Conversation, Message, TapbackKind } from "../api/types";
import { attachmentLabel } from "../utils/attachments";
import { ConversationAvatar } from "./Avatar";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

interface ChatViewProps {
  conversation: Conversation;
  messages: Message[] | undefined;
  messageError: string | null;
  historyState: "idle" | "loading" | "done";
  onLoadOlder: () => void;
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
  historyState,
  onLoadOlder,
  capabilities,
  loadAttachment,
  onRetry,
  onSendText,
  onSendFile,
  onReact,
}: ChatViewProps) {
  const [reply, setReply] = useState<{ conversationId: string; message: Message } | null>(null);
  const replyingTo = reply?.conversationId === conversation.id ? reply.message : null;
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const canDrop = (capabilities?.attachments ?? false) && messages !== undefined;

  const title =
    conversation.displayName ??
    conversation.participants.map((p) => p.displayName ?? p.handle).join(", ");

  const carriesFiles = (e: DragEvent) => canDrop && e.dataTransfer.types.includes("Files");
  const endDrag = () => {
    dragDepth.current = 0;
    setDragging(false);
  };
  const replyName = replyingTo?.isFromMe
    ? "Yourself"
    : (replyingTo?.sender?.displayName ?? replyingTo?.sender?.handle ?? title);

  return (
    <section
      className="chat-view"
      onDragEnter={(e) => {
        if (!carriesFiles(e)) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!carriesFiles(e)) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) endDrag();
      }}
      onDrop={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        endDrag();
        for (const item of Array.from(e.dataTransfer.items)) {
          if (item.kind !== "file" || item.webkitGetAsEntry()?.isDirectory) continue;
          const file = item.getAsFile();
          if (file) onSendFile(file);
        }
      }}
    >
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3" strokeLinecap="round" />
            </svg>
            <span>Send to {title}</span>
          </div>
        </div>
      )}
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
          historyState={historyState}
          onLoadOlder={onLoadOlder}
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
