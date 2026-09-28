import { useRef } from "react";
import type { Reaction, TapbackKind } from "../api/types";

export const TAPBACKS: { kind: TapbackKind; label: string }[] = [
  { kind: "love", label: "Love" },
  { kind: "like", label: "Like" },
  { kind: "dislike", label: "Dislike" },
  { kind: "laugh", label: "Laugh" },
  { kind: "emphasize", label: "Emphasize" },
  { kind: "question", label: "Question" },
];

const HEART = "M8 14s-6-3.87-6-8a3.5 3.5 0 0 1 6-2.45A3.5 3.5 0 0 1 14 6c0 4.13-6 8-6 8z";
const THUMB =
  "M2 7h2.5v7H2zM6 14h5.6a1.5 1.5 0 0 0 1.46-1.16l1-4.3A1.5 1.5 0 0 0 12.6 6.7H9.5l.5-2.6A1.4 1.4 0 0 0 8.6 2.5L6 7z";

export function TapbackIcon({ kind, size }: { kind: TapbackKind; size: number }) {
  switch (kind) {
    case "love":
      return (
        <svg viewBox="0 0 16 16" width={size} height={size}>
          <path d={HEART} fill="currentColor" />
        </svg>
      );
    case "like":
      return (
        <svg viewBox="0 0 16 16" width={size} height={size}>
          <path d={THUMB} fill="currentColor" />
        </svg>
      );
    case "dislike":
      return (
        <svg viewBox="0 0 16 16" width={size} height={size}>
          <path d={THUMB} fill="currentColor" transform="matrix(1 0 0 -1 0 16)" />
        </svg>
      );
    case "laugh":
      return (
        <span className="tapback-glyph tapback-haha" style={{ fontSize: size * 0.58 }}>
          HA
          <br />
          HA
        </span>
      );
    case "emphasize":
      return (
        <span className="tapback-glyph" style={{ fontSize: size * 0.9 }}>
          !!
        </span>
      );
    case "question":
      return (
        <span className="tapback-glyph" style={{ fontSize: size }}>
          ?
        </span>
      );
  }
}

export function ReactionBadges({ reactions }: { reactions: Reaction[] }) {
  const initialKinds = useRef(new Set(reactions.map((r) => r.kind)));
  if (reactions.length === 0) return null;
  const byKind = new Map<TapbackKind, Reaction[]>();
  for (const r of [...reactions].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt))) {
    const list = byKind.get(r.kind) ?? [];
    byKind.delete(r.kind);
    byKind.set(r.kind, [...list, r]);
  }
  const groups = [...byKind].reverse();

  return (
    <div className="reactions">
      {groups.map(([kind, list], i) => {
        const label = TAPBACKS.find((t) => t.kind === kind)?.label;
        const names = list.map((r) =>
          r.isFromMe ? "You" : (r.sender?.displayName ?? r.sender?.handle ?? "Someone")
        );
        return (
          <span
            key={kind}
            className={[
              "reaction-badge",
              `kind-${kind}`,
              list.some((r) => r.isFromMe) ? "mine" : "",
              initialKinds.current.has(kind) ? "" : "reaction-pop",
            ].join(" ")}
            style={{ zIndex: groups.length - i }}
            title={`${label}: ${names.join(", ")}`}
          >
            <TapbackIcon kind={kind} size={14} />
          </span>
        );
      })}
    </div>
  );
}
