import type { Conversation, Participant } from "../api/types";

function initials(name: string | null, handle: string): string {
  if (!name) return handle.slice(-2);
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ participant, size }: { participant: Participant; size: number }) {
  if (participant.avatarUrl) {
    return (
      <img
        className="avatar"
        src={participant.avatarUrl}
        alt=""
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div className="avatar avatar-initials" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initials(participant.displayName, participant.handle)}
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
