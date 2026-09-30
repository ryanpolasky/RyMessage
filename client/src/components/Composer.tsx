import { useEffect, useRef, useState } from "react";
import type { Service } from "../api/types";
import type { EmojiIndex } from "../emoji";
import { loadEmojiIndex } from "../emoji";
import { EmojiPicker } from "./EmojiPicker";

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

interface CodeAutocomplete {
  start: number;
  end: number;
  items: { code: string; char: string; name: string }[];
  active: number;
}

const SHORTCODE_PATTERN = /(?:^|\s)(:[a-zA-Z0-9_+-]{2,})$/;
const CLOSED_CODE_PATTERN = /(?:^|\s)(:([a-zA-Z0-9_+-]{2,}):)$/;

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
  const [ac, setAc] = useState<CodeAutocomplete | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const emojiIndexRef = useRef<EmojiIndex | null>(null);

  useEffect(() => {
    void loadEmojiIndex().then((index) => {
      emojiIndexRef.current = index;
    });
  }, []);

  useEffect(() => {
    setText("");
    setAc(null);
    setPickerOpen(false);
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
    setAc(null);
    resize("");
  }

  function resize(value: string) {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    if (!value) el.style.height = "auto";
  }

  function updateAutocomplete(value: string, caret: number) {
    const index = emojiIndexRef.current;
    const before = value.slice(0, caret);
    const closed = index && CLOSED_CODE_PATTERN.exec(before);
    if (closed) {
      const option = index.exactCode(closed[2]);
      if (option) {
        const start = caret - closed[1].length;
        applyText(
          value.slice(0, start) + option.char + value.slice(caret),
          start + option.char.length
        );
        return;
      }
      if (ac) setAc(null);
      return;
    }
    const match = index && SHORTCODE_PATTERN.exec(before);
    if (!match) {
      if (ac) setAc(null);
      return;
    }
    const token = match[1];
    const items = index.searchCodes(token.slice(1), 8).map((m) => ({
      code: m.code,
      char: m.emoji.char,
      name: m.emoji.name,
    }));
    setAc(items.length ? { start: caret - token.length, end: caret, items, active: 0 } : null);
  }

  function applyText(next: string, caret: number) {
    setText(next);
    resize(next);
    updateAutocomplete(next, caret);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  }

  function insertEmoji(char: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    applyText(text.slice(0, start) + char + text.slice(end), start + char.length);
  }

  function acceptAutocomplete(active: number) {
    if (!ac) return;
    const item = ac.items[active];
    applyText(text.slice(0, ac.start) + item.char + text.slice(ac.end), ac.start + item.char.length);
    setAc(null);
  }

  function pastedFile(file: File): File {
    if (file.name) return file;
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[
      file.type
    ] ?? "png";
    return new File([file], `Pasted Image.${ext}`, { type: file.type });
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
      {canSendText && (
        <div className="emoji-anchor">
          <button
            className="attach-button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPickerOpen((open) => !open)}
            disabled={!ready}
            title="Emoji"
          >
            <svg viewBox="0 0 16 16" width="16" height="16">
              <path
                d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z"
                fill="currentColor"
              />
              <circle cx="5.7" cy="6.4" r="0.95" fill="currentColor" />
              <circle cx="10.3" cy="6.4" r="0.95" fill="currentColor" />
              <path
                d="M5.1 9.35a.55.55 0 0 1 .76-.1 3.95 3.95 0 0 0 4.28 0 .55.55 0 0 1 .66.86 5.05 5.05 0 0 1-5.6 0 .55.55 0 0 1-.1-.76z"
                fill="currentColor"
              />
            </svg>
          </button>
          {pickerOpen && (
            <EmojiPicker onPick={insertEmoji} onClose={() => setPickerOpen(false)} />
          )}
        </div>
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
            updateAutocomplete(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) => {
            // caret-driven recompute would reopen the popup right after Escape closes it
            const caret = e.currentTarget.selectionStart;
            if (ac && (caret <= ac.start || caret > ac.end)) setAc(null);
          }}
          onPaste={(e) => {
            if (!canAttach || !ready) return;
            const files = Array.from(e.clipboardData.files);
            if (!files.length) return;
            e.preventDefault();
            for (const file of files) onSendFile(pastedFile(file));
          }}
          onKeyDown={(e) => {
            if (ac) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAc({ ...ac, active: (ac.active + 1) % ac.items.length });
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setAc({ ...ac, active: (ac.active + ac.items.length - 1) % ac.items.length });
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                acceptAutocomplete(ac.active);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setAc(null);
                return;
              }
            }
            // enter mid-IME picks a character, it shouldn't send
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            } else if (e.key === "Escape") {
              if (pickerOpen) setPickerOpen(false);
              else if (replyTargetId) onCancelReply();
            }
          }}
        />
        {ac && (
          <div className="emoji-ac">
            {ac.items.map((item, i) => (
              <button
                key={item.code}
                className={`emoji-ac-item ${i === ac.active ? "active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => acceptAutocomplete(i)}
                onMouseEnter={() => setAc({ ...ac, active: i })}
              >
                <span className="emoji-ac-char">{item.char}</span>
                <span className="emoji-ac-code">:{item.code}:</span>
                <span className="emoji-ac-name">{item.name}</span>
              </button>
            ))}
          </div>
        )}
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
