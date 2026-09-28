import { useEffect, useRef, useState } from "react";
import type { Service } from "../api/types";

interface ComposerProps {
  conversationId: string;
  service: Service;
  ready: boolean;
  canSendText: boolean;
  canAttach: boolean;
  replyTargetId: string | null;
  onCancelReply: () => void;
  onSendText: (text: string) => void;
  onSendFile: (file: File) => void;
}

export function Composer({
  conversationId,
  service,
  ready,
  canSendText,
  canAttach,
  replyTargetId,
  onCancelReply,
  onSendText,
  onSendFile,
}: ComposerProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText("");
    inputRef.current?.focus();
  }, [conversationId]);

  useEffect(() => {
    if (replyTargetId) inputRef.current?.focus();
  }, [replyTargetId]);

  function send() {
    const trimmed = text.trim();
    if (!trimmed || !ready) return;
    onSendText(trimmed);
    setText("");
    resize("");
  }

  function resize(value: string) {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    if (!value) el.style.height = "auto";
  }

  const placeholder = !canSendText
    ? "Sending isn't supported by this server"
    : service === "SMS"
      ? "Text Message"
      : "iMessage";

  return (
    <div className={`composer ${service === "SMS" ? "sms" : ""}`}>
      {canAttach && (
        <>
          <button
            className="attach-button"
            onClick={() => fileRef.current?.click()}
            disabled={!ready}
            title="Attach"
          >
            <svg viewBox="0 0 16 16" width="16" height="16">
              <path
                d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"
                fill="currentColor"
              />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onSendFile(file);
              e.target.value = "";
            }}
          />
        </>
      )}
      <div className="composer-field">
        <textarea
          ref={inputRef}
          rows={1}
          placeholder={placeholder}
          value={text}
          disabled={!canSendText}
          onChange={(e) => {
            setText(e.target.value);
            resize(e.target.value);
          }}
          onKeyDown={(e) => {
            // enter mid-IME picks a character, it shouldn't send
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            } else if (e.key === "Escape" && replyTargetId) {
              onCancelReply();
            }
          }}
        />
        <button
          className={`send-button ${text.trim() && canSendText ? "visible" : ""}`}
          onClick={send}
          title="Send"
        >
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path
              d="M8 13.5a.75.75 0 0 1-.75-.75V5.06L4.53 7.78a.75.75 0 0 1-1.06-1.06l4-4a.75.75 0 0 1 1.06 0l4 4a.75.75 0 1 1-1.06 1.06L8.75 5.06v7.69A.75.75 0 0 1 8 13.5z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
