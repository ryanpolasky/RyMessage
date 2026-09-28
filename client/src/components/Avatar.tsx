import type { Conversation, Participant } from "../api/types";
import { useAvatarSrc } from "../avatars";

function initials(name: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ participant, size }: { participant: Participant; size: number }) {
  const src = useAvatarSrc(participant.avatarUrl);
  if (src) {
    return <img className="avatar" src={src} alt="" style={{ width: size, height: size }} />;
  }
  const letters = initials(participant.displayName);
  return (
    <div className="avatar avatar-initials" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {letters ?? (
        <svg viewBox="0 0 100 100" width={size} height={size}>
          <circle cx="50" cy="40" r="17" fill="currentColor" />
          <ellipse cx="50" cy="92" rx="31" ry="25" fill="currentColor" />
        </svg>
      )}
    </div>
  );
}

export function ConversationAvatar({ conversation, size }: { conversation: Conversation; size: number }) {
  if (!conversation.isGroup || conversation.participants.length < 2) {
    return <Avatar participant={conversation.participants[0]} size={size} />;
  }
  const [first, second] = conversation.participants;
  return (
    <div className="avatar-group" style={{ width: size, height: size }}>
      <div className="avatar-group-back">
        <Avatar participant={second} size={size * 0.68} />
      </div>
      <div className="avatar-group-front">
        <Avatar participant={first} size={size * 0.68} />
      </div>
    </div>
  );
}
