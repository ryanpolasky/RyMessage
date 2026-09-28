import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getLaunchAtLogin, isDesktop, setLaunchAtLogin, showTestNotice } from "../desktop";
import type { Settings } from "../settings";
import { DISMISS_OPTIONS } from "../settings";
import { CHIME, SILENT, decodeAudio, forgetSound, playNotificationSound, stopNotificationSound } from "../sound";
import type { CustomSound } from "../soundLibrary";
import { deleteSound, listSounds, putSound, stripExtension } from "../soundLibrary";
import { Picker } from "./Picker";
import { SoundEditor } from "./SoundEditor";

interface SettingsPanelProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

interface EditorState {
  source: AudioBuffer;
  name: string;
  existing: CustomSound | null;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? "on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

function Row({
  label,
  detail,
  disabled,
  children,
}: {
  label: string;
  detail?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`settings-row ${disabled ? "disabled" : ""}`}>
      <div className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {detail && <span className="settings-row-detail">{detail}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10">
      <path d="M3 1.8v8.4a.6.6 0 0 0 .9.5l6.6-4.2a.6.6 0 0 0 0-1L3.9 1.3a.6.6 0 0 0-.9.5z" fill="currentColor" />
    </svg>
  );
}

function SoundRow({
  sound,
  onRename,
  onEdit,
  onDelete,
}: {
  sound: CustomSound;
  onRename: (name: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(sound.name);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  function commit() {
    setRenaming(false);
    const name = draft.trim();
    if (name && name !== sound.name) onRename(name);
    else setDraft(sound.name);
  }

  return (
    <div className="settings-row sound-row">
      <button className="sound-play" title="Play" onClick={() => void playNotificationSound(sound.id)}>
        <PlayIcon />
      </button>
      {renaming ? (
        <input
          className="sound-rename"
          value={draft}
          maxLength={40}
          autoFocus
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(sound.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <button className="sound-name" title="Click to rename" onClick={() => setRenaming(true)}>
          {sound.name}
        </button>
      )}
      <span className="sound-duration">{(sound.durationMs / 1000).toFixed(1)}s</span>
      <div className="settings-row-control">
        <button className="settings-button" onClick={onEdit}>
          Edit
        </button>
        <button
          className={`settings-button ${confirming ? "danger" : ""}`}
          onClick={() => (confirming ? onDelete() : setConfirming(true))}
        >
          {confirming ? "Delete?" : "Remove"}
        </button>
      </div>
    </div>
  );
}

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  const [launchAtLogin, setLaunchState] = useState<boolean | null>(null);
  const [sounds, setSounds] = useState<CustomSound[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshSounds = useCallback(() => {
    listSounds().then(setSounds, (e) => setError(`Couldn't load your sounds: ${e}`));
  }, []);

  useEffect(() => {
    refreshSounds();
    if (!isDesktop) return;
    getLaunchAtLogin().then(setLaunchState, (e) => setError(`Couldn't read launch at login: ${e}`));
  }, [refreshSounds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editor) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editor]);

  async function toggleLaunchAtLogin(enabled: boolean) {
    setError(null);
    try {
      await setLaunchAtLogin(enabled);
      setLaunchState(await getLaunchAtLogin());
    } catch (e) {
      setError(`Couldn't change launch at login: ${e}`);
    }
  }

  async function openEditor(blob: Blob, name: string, existing: CustomSound | null) {
    setError(null);
    try {
      const source = await decodeAudio(await blob.arrayBuffer());
      setEditor({ source, name, existing });
    } catch {
      setError("Couldn't read that audio file. Try an MP3, WAV, M4A, or OGG.");
    }
  }

  async function saveEdited(name: string, blob: Blob, durationMs: number) {
    const existing = editor?.existing;
    const id = existing?.id ?? crypto.randomUUID();
    await putSound({ id, name, blob, durationMs, createdAt: existing?.createdAt ?? Date.now() });
    forgetSound(id);
    setEditor(null);
    refreshSounds();
    onChange({ sound: id });
    void playNotificationSound(id);
  }

  async function removeSound(id: string) {
    stopNotificationSound();
    await deleteSound(id);
    forgetSound(id);
    if (settings.sound === id) onChange({ sound: CHIME });
    refreshSounds();
  }

  async function renameSound(sound: CustomSound, name: string) {
    await putSound({ ...sound, name });
    refreshSounds();
  }

  const overlayOn = isDesktop && settings.overlay;
  const soundOptions = [
    { value: CHIME, label: "Chime" },
    ...sounds.map((s) => ({ value: s.id, label: s.name })),
    { value: SILENT, label: "None" },
  ];

  return (
    <div className="settings-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-sheet" role="dialog" aria-label="Settings">
        <header className="settings-header">
          <h2>Settings</h2>
          <button className="primary-button settings-done" onClick={onClose}>
            Done
          </button>
        </header>

        <h3 className="settings-section-title">Notifications</h3>
        <div className="settings-group">
          <Row
            label="Desktop overlay"
            detail="New texts float in the top-left corner of your screen."
            disabled={!isDesktop}
          >
            <Switch
              label="Desktop overlay"
              checked={overlayOn}
              disabled={!isDesktop}
              onChange={(overlay) => onChange({ overlay })}
            />
          </Row>
          <Row label="Dismiss after" disabled={!overlayOn}>
            <Picker
              label="Dismiss after"
              value={settings.dismissAfterSeconds}
              disabled={!overlayOn}
              options={DISMISS_OPTIONS.map((seconds) => ({
                value: seconds,
                label: seconds === 0 ? "Never, until swiped" : `${seconds} seconds`,
              }))}
              onChange={(dismissAfterSeconds) => onChange({ dismissAfterSeconds })}
            />
          </Row>
          <Row label="Sound">
            <button
              className="settings-button"
              disabled={settings.sound === SILENT}
              onClick={() => void playNotificationSound(settings.sound)}
            >
              Play
            </button>
            <Picker
              label="Notification sound"
              value={soundOptions.some((o) => o.value === settings.sound) ? settings.sound : CHIME}
              options={soundOptions}
              onChange={(sound) => onChange({ sound })}
            />
          </Row>
        </div>
        {overlayOn && (
          <button
            className="link-button settings-test"
            onClick={() => {
              void playNotificationSound(settings.sound);
              showTestNotice().catch((e) => setError(`Couldn't show a test bubble: ${e}`));
            }}
          >
            Show a test bubble
          </button>
        )}

        <h3 className="settings-section-title">Custom Sounds</h3>
        <div className="settings-group">
          {sounds.map((sound) => (
            <SoundRow
              key={sound.id}
              sound={sound}
              onRename={(name) => void renameSound(sound, name)}
              onEdit={() => void openEditor(sound.blob, sound.name, sound)}
              onDelete={() => void removeSound(sound.id)}
            />
          ))}
          <Row
            label="Add a sound"
            detail="Trim it, set the volume, and add fades. RyMessage keeps its own copy."
          >
            <button className="settings-button" onClick={() => fileRef.current?.click()}>
              Choose…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (file.size > MAX_UPLOAD_BYTES) return setError("Pick an audio file under 20 MB.");
                void openEditor(file, stripExtension(file.name), null);
              }}
            />
          </Row>
        </div>

        <h3 className="settings-section-title">Window</h3>
        <div className="settings-group">
          <Row
            label="Minimize to tray"
            detail="The minimize button hides RyMessage to the tray."
            disabled={!isDesktop}
          >
            <Switch
              label="Minimize to tray"
              checked={isDesktop && settings.minimizeToTray}
              disabled={!isDesktop}
              onChange={(minimizeToTray) => onChange({ minimizeToTray })}
            />
          </Row>
          <Row
            label="Launch at login"
            detail="Starts hidden in the tray when you sign in to Windows."
            disabled={!isDesktop}
          >
            <Switch
              label="Launch at login"
              checked={launchAtLogin === true}
              disabled={!isDesktop || launchAtLogin === null}
              onChange={toggleLaunchAtLogin}
            />
          </Row>
        </div>

        {!isDesktop && (
          <p className="settings-note">Overlay and window settings are available in the desktop app.</p>
        )}
        {error && <p className="settings-error">{error}</p>}
      </div>
      {editor && (
        <SoundEditor
          title={editor.existing ? "Edit Sound" : "New Sound"}
          source={editor.source}
          initialName={editor.name}
          onCancel={() => setEditor(null)}
          onSave={saveEdited}
        />
      )}
    </div>
  );
}
