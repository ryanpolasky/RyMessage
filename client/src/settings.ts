import { useEffect, useState } from "react";

export interface Settings {
  overlay: boolean;
  dismissAfterSeconds: number;
  sound: string;
  minimizeToTray: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  overlay: true,
  dismissAfterSeconds: 7,
  sound: "chime",
  minimizeToTray: false,
};

export const DISMISS_OPTIONS = [3, 5, 7, 10, 15, 0];

const SETTINGS_KEY = "rymessage.settings";

function readStored(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function loadSettings(): Settings {
  const { customSoundName: _legacy, ...stored } = readStored();
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function legacyCustomSoundName(): string | null {
  const name = readStored().customSoundName;
  return typeof name === "string" ? name : null;
}

export function clearLegacyCustomSoundName(): void {
  const { customSoundName: _legacy, ...rest } = readStored();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState(loadSettings);

  // other windows share this key, so fields this one doesn't know about are kept
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readStored(), ...settings }));
  }, [settings]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_KEY) setSettings(loadSettings());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return [settings, (patch) => setSettings((prev) => ({ ...prev, ...patch }))];
}
