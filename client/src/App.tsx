import { useCallback, useEffect, useMemo, useState } from "react";
import type { Attachment } from "./api/types";
import { AvatarLoaderContext } from "./avatars";
import { ChatView } from "./components/ChatView";
import { ComposeView } from "./components/ComposeView";
import { Onboarding } from "./components/Onboarding";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import type { Connection } from "./connection";
import { clearConnection, createBridge, loadConnection } from "./connection";
import { useDirectory } from "./contacts";
import { hideOnMinimize, isDesktop } from "./desktop";
import type { Settings } from "./settings";
import { useSettings } from "./settings";
import { migrateLegacySound } from "./soundLibrary";
import { useRyMessageStore } from "./store";
import { useIncomingNotifications } from "./useIncomingNotifications";

export function App() {
  const [connection, setConnection] = useState<Connection | null>(loadConnection);
  const [settings, updateSettings] = useSettings();

  useEffect(() => {
    const wasCustom = settings.sound === "custom";
    migrateLegacySound().then(
      (id) => {
        if (id && wasCustom) updateSettings({ sound: id });
      },
      (e) => console.warn("Couldn't move the old custom sound into the library", e)
    );
  }, []);

  useEffect(() => {
    if (!isDesktop || !settings.minimizeToTray) return;
    return hideOnMinimize();
  }, [settings.minimizeToTray]);

  if (!connection) {
    return <Onboarding onConnected={setConnection} />;
  }
  return (
    <Messenger
      connection={connection}
      settings={settings}
      onSettingsChange={updateSettings}
      onDisconnect={() => {
        clearConnection();
        setConnection(null);
      }}
    />
  );
}

function Messenger({
  connection,
  settings,
  onSettingsChange,
  onDisconnect,
}: {
  connection: Connection;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onDisconnect: () => void;
}) {
  const bridge = useMemo(() => createBridge(connection), [connection]);
  useEffect(() => () => bridge.close(), [bridge]);
  const store = useRyMessageStore(bridge);
  useIncomingNotifications(
    bridge,
    store.conversations,
    settings,
    store.selectConversation
  );
  const loadAttachment = useCallback(
    (attachment: Attachment) => bridge.getAttachment(attachment),
    [bridge]
  );
  const loadAvatar = useCallback((url: string) => bridge.getAvatar(url), [bridge]);
  const directory = useDirectory(
    bridge,
    connection.mode === "demo" ? "demo" : connection.url,
    store.capabilities?.contacts ?? false,
    store.status,
    store.conversations
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const [composing, setComposing] = useState(false);
  const canCompose = store.capabilities?.compose ?? false;

  const openConversation = useCallback(
    (id: string) => {
      setComposing(false);
      store.selectConversation(id);
    },
    [store.selectConversation]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key.toLowerCase() === "n" && canCompose) {
        e.preventDefault();
        setComposing(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canCompose]);

  const connectionLabel =
    connection.mode === "demo" ? "Demo Mode" : new URL(connection.url).host;

  return (
    <AvatarLoaderContext.Provider value={loadAvatar}>
      <div className="app">
        <Sidebar
          conversations={store.conversations}
          loading={store.conversationsLoading}
          loadError={store.loadError}
          onRetry={store.retryLoad}
          selectedId={composing ? null : (store.selected?.id ?? null)}
          onSelect={openConversation}
          onTogglePin={store.togglePin}
          onDelete={store.hideConversation}
          status={store.status}
          connectionLabel={connectionLabel}
          disconnectLabel={connection.mode === "demo" ? "Exit" : "Disconnect"}
          onDisconnect={onDisconnect}
          onOpenSettings={() => setSettingsOpen(true)}
          composing={composing}
          canCompose={canCompose}
          onCompose={() => setComposing(true)}
        />
        {composing ? (
          <ComposeView
            directory={directory}
            conversations={store.conversations}
            capabilities={store.capabilities}
            onOpenConversation={openConversation}
            onStart={async (to, text) => openConversation(await store.startConversation(to, text))}
            onCancel={() => setComposing(false)}
          />
        ) : store.selected ? (
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
        {settingsOpen && (
          <SettingsPanel settings={settings} onChange={onSettingsChange} onClose={closeSettings} />
        )}
      </div>
    </AvatarLoaderContext.Provider>
  );
}
