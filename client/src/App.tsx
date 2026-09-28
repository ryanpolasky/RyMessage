import { useCallback, useEffect, useMemo, useState } from "react";
import type { Attachment } from "./api/types";
import { ChatView } from "./components/ChatView";
import { Onboarding } from "./components/Onboarding";
import { Sidebar } from "./components/Sidebar";
import type { Connection } from "./connection";
import { clearConnection, createBridge, loadConnection } from "./connection";
import { useRyMessageStore } from "./store";
import { useOverlayNotifications } from "./useOverlayNotifications";

export function App() {
  const [connection, setConnection] = useState<Connection | null>(loadConnection);

  if (!connection) {
    return <Onboarding onConnected={setConnection} />;
  }
  return (
    <Messenger
      connection={connection}
      onDisconnect={() => {
        clearConnection();
        setConnection(null);
      }}
    />
  );
}

function Messenger({
  connection,
  onDisconnect,
}: {
  connection: Connection;
  onDisconnect: () => void;
}) {
  const bridge = useMemo(() => createBridge(connection), [connection]);
  useEffect(() => () => bridge.close(), [bridge]);
  const store = useRyMessageStore(bridge);
  useOverlayNotifications(
    bridge,
    store.conversations,
    store.selected?.id ?? null,
    store.selectConversation
  );
  const loadAttachment = useCallback(
    (attachment: Attachment) => bridge.getAttachment(attachment),
    [bridge]
  );

  const connectionLabel =
    connection.mode === "demo" ? "Demo Mode" : new URL(connection.url).host;

  return (
    <div className="app">
      <Sidebar
        conversations={store.conversations}
        loading={store.conversationsLoading}
        loadError={store.loadError}
        onRetry={store.retryLoad}
        selectedId={store.selected?.id ?? null}
        onSelect={store.selectConversation}
        onTogglePin={store.togglePin}
        status={store.status}
        connectionLabel={connectionLabel}
        disconnectLabel={connection.mode === "demo" ? "Exit" : "Disconnect"}
        onDisconnect={onDisconnect}
      />
      {store.selected ? (
        <ChatView
          conversation={store.selected}
          messages={store.messages[store.selected.id]}
          messageError={store.messageError}
          capabilities={store.capabilities}
          loadAttachment={loadAttachment}
          onRetry={store.retryLoadMessages}
          onSendText={(text, replyTo) => store.sendText(store.selected!.id, text, replyTo)}
          onReact={store.setReaction}
          onSendFile={(file) => store.sendFile(store.selected!.id, file)}
        />
      ) : (
        <section className="chat-view empty">
          <span>No Conversation Selected</span>
        </section>
      )}
    </div>
  );
}
