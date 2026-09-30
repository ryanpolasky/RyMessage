import { useEffect, useRef, useState } from "react";
import type { EmojiIndex } from "../emoji";
import {
  getEmojiTone,
  getRecentEmojis,
  loadEmojiIndex,
  recordRecentEmoji,
  setEmojiTone,
  withTone,
} from "../emoji";

interface EmojiPickerProps {
  onPick: (char: string) => void;
  onClose: () => void;
}

const TONE_ICONS = ["👋", "👋🏻", "👋🏼", "👋🏽", "👋🏾", "👋🏿"];

export function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const [index, setIndex] = useState<EmojiIndex | null>(null);
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState(getEmojiTone);
  const [recents, setRecents] = useState(getRecentEmojis);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadEmojiIndex().then(setIndex);
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const results = query.trim() ? (index?.search(query) ?? []) : [];

  function pick(char: string) {
    onPick(char);
    setRecents(recordRecentEmoji(char));
  }

  function jumpTo(key: string) {
    scrollRef.current
      ?.querySelector(`[data-section="${key}"]`)
      ?.scrollIntoView({ block: "start" });
  }

  function cell(char: string, name: string, key: string | number) {
    return (
      <button key={key} className="emoji-cell" title={name} onClick={() => pick(char)}>
        {char}
      </button>
    );
  }

  return (
    <div
      className="emoji-picker"
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="emoji-picker-search">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              pick(withTone(results[0], tone));
            }
          }}
        />
      </div>
      {!query && index && (
        <div className="emoji-picker-tabs">
          {recents.length > 0 && (
            <button className="emoji-tab" title="Recently Used" onClick={() => jumpTo("recent")}>
              🕒
            </button>
          )}
          {index.sections.map((s) => (
            <button
              key={s.key}
              className="emoji-tab"
              title={s.label}
              onClick={() => jumpTo(s.key)}
            >
              {s.icon}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-picker-scroll" ref={scrollRef}>
        {!index ? (
          <div className="emoji-picker-empty">Loading…</div>
        ) : query ? (
          results.length ? (
            <div className="emoji-grid">
              {results.map((o) => cell(withTone(o, tone), o.name, o.char))}
            </div>
          ) : (
            <div className="emoji-picker-empty">No Results</div>
          )
        ) : (
          <>
            {recents.length > 0 && (
              <div data-section="recent">
                <div className="emoji-section-label">Recently Used</div>
                <div className="emoji-grid">
                  {recents.map((char) => cell(char, char, `recent-${char}`))}
                </div>
              </div>
            )}
            {index.sections.map((s) => (
              <div key={s.key} data-section={s.key}>
                <div className="emoji-section-label">{s.label}</div>
                <div className="emoji-grid">
                  {s.emojis.map((o) => cell(withTone(o, tone), o.name, o.char))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="emoji-picker-tones">
        {TONE_ICONS.map((icon, i) => (
          <button
            key={i}
            className={`emoji-tone ${tone === i ? "active" : ""}`}
            title={i === 0 ? "Default skin tone" : `Skin tone ${i}`}
            onClick={() => {
              setTone(i);
              setEmojiTone(i);
            }}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
