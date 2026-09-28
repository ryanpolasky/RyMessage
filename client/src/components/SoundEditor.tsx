import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { audioContext, stopNotificationSound } from "../sound";

interface SoundEditorProps {
  title: string;
  source: AudioBuffer;
  initialName: string;
  onCancel: () => void;
  onSave: (name: string, blob: Blob, durationMs: number) => Promise<void>;
}

interface Edit {
  start: number;
  end: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

const MAX_SECONDS = 10;
const MIN_SECONDS = 0.1;
const MAX_FADE = 2;
const WAVE_HEIGHT = 96;

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

function computePeaks(buffer: AudioBuffer, columns: number): Float32Array {
  const peaks = new Float32Array(columns);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const perColumn = buffer.length / columns;
  for (let col = 0; col < columns; col++) {
    const from = Math.floor(col * perColumn);
    const to = Math.min(buffer.length, Math.floor((col + 1) * perColumn));
    const step = Math.max(1, Math.floor((to - from) / 256));
    let max = 0;
    for (const data of channels) {
      for (let i = from; i < to; i += step) max = Math.max(max, Math.abs(data[i]));
    }
    peaks[col] = max;
  }
  return peaks;
}

function gainAt(t: number, edit: Edit): number {
  if (t < edit.start || t > edit.end) return 0;
  let gain = edit.volume;
  if (edit.fadeIn > 0 && t < edit.start + edit.fadeIn) gain *= (t - edit.start) / edit.fadeIn;
  if (edit.fadeOut > 0 && t > edit.end - edit.fadeOut) gain *= (edit.end - t) / edit.fadeOut;
  return gain;
}

function schedule(ctx: BaseAudioContext, buffer: AudioBuffer, when: number, edit: Edit): AudioBufferSourceNode {
  const length = edit.end - edit.start;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.connect(gain).connect(ctx.destination);
  const g = gain.gain;
  g.setValueAtTime(edit.fadeIn > 0 ? 0 : edit.volume, when);
  if (edit.fadeIn > 0) g.linearRampToValueAtTime(edit.volume, when + edit.fadeIn);
  if (edit.fadeOut > 0) {
    g.setValueAtTime(edit.volume, when + length - edit.fadeOut);
    g.linearRampToValueAtTime(0, when + length);
  }
  source.start(when, edit.start, length);
  return source;
}

function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const blockAlign = channels * 2;
  const view = new DataView(new ArrayBuffer(44 + frames * blockAlign));
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * blockAlign, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * blockAlign, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}

export function SoundEditor({ title, source, initialName, onCancel, onSave }: SoundEditorProps) {
  const duration = source.duration;
  const [name, setName] = useState(initialName);
  const [edit, setEdit] = useState<Edit>({
    start: 0,
    end: Math.min(duration, MAX_SECONDS),
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
  });
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const preview = useRef<{ source: AudioBufferSourceNode; frame: number } | null>(null);
  const [width, setWidth] = useState(0);

  const length = edit.end - edit.start;
  const maxFade = Math.min(MAX_FADE, length / 2);
  const peaks = useMemo(() => (width ? computePeaks(source, width) : null), [source, width]);

  useLayoutEffect(() => {
    const track = trackRef.current!;
    const observer = new ResizeObserver(() => setWidth(Math.floor(track.clientWidth)));
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = WAVE_HEIGHT * ratio;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, WAVE_HEIGHT);
    const styles = getComputedStyle(canvas);
    const active = styles.getPropertyValue("--wave-active").trim();
    const idle = styles.getPropertyValue("--wave-idle").trim();
    const mid = WAVE_HEIGHT / 2;
    const loudest = peaks.reduce((max, p) => Math.max(max, p), 0);
    const scale = loudest > 0 ? 0.9 / loudest : 1;
    for (let x = 0; x < width; x++) {
      const t = ((x + 0.5) / width) * duration;
      const inside = t >= edit.start && t <= edit.end;
      const level = inside ? peaks[x] * gainAt(t, edit) : peaks[x];
      const clipped = inside && level > 1;
      const h = Math.max(1, Math.min(1, level * scale) * (mid - 2));
      ctx.fillStyle = clipped ? "#ff453a" : inside ? active : idle;
      ctx.fillRect(x, mid - h, 1, h * 2);
    }
  }, [peaks, edit, width, duration]);

  function stopPreview() {
    if (!preview.current) return;
    cancelAnimationFrame(preview.current.frame);
    preview.current.source.onended = null;
    preview.current.source.stop();
    preview.current = null;
    setPlayhead(null);
  }

  useEffect(() => stopPreview, []);

  function togglePreview() {
    if (preview.current) return stopPreview();
    stopNotificationSound();
    const ctx = audioContext();
    const startedAt = ctx.currentTime + 0.02;
    const node = schedule(ctx, source, startedAt, edit);
    const snapshot = { ...edit };
    const tick = () => {
      const t = snapshot.start + Math.max(0, ctx.currentTime - startedAt);
      setPlayhead(Math.min(t, snapshot.end));
      if (preview.current) preview.current.frame = requestAnimationFrame(tick);
    };
    preview.current = { source: node, frame: requestAnimationFrame(tick) };
    node.onended = stopPreview;
  }

  function dragHandle(which: "start" | "end") {
    return (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      stopPreview();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const rect = trackRef.current!.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const t = Math.max(0, Math.min(duration, ((ev.clientX - rect.left) / rect.width) * duration));
        setEdit((prev) => {
          const next =
            which === "start"
              ? { ...prev, start: Math.min(Math.max(t, prev.end - MAX_SECONDS), prev.end - MIN_SECONDS) }
              : { ...prev, end: Math.max(Math.min(t, prev.start + MAX_SECONDS), prev.start + MIN_SECONDS) };
          const fadeLimit = Math.min(MAX_FADE, (next.end - next.start) / 2);
          return { ...next, fadeIn: Math.min(next.fadeIn, fadeLimit), fadeOut: Math.min(next.fadeOut, fadeLimit) };
        });
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    };
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the sound a name.");
    stopPreview();
    setSaving(true);
    setError(null);
    try {
      const channels = Math.min(2, source.numberOfChannels);
      const offline = new OfflineAudioContext(channels, Math.ceil(length * source.sampleRate), source.sampleRate);
      schedule(offline, source, 0, edit);
      const rendered = await offline.startRendering();
      await onSave(trimmed, encodeWav(rendered), Math.round(length * 1000));
    } catch (e) {
      setError(`Couldn't save the sound: ${e instanceof Error ? e.message : e}`);
      setSaving(false);
    }
  }

  const pct = (t: number) => `${(t / duration) * 100}%`;

  return (
    <div className="settings-backdrop editor-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="settings-sheet editor-sheet"
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <header className="settings-header">
          <h2>{title}</h2>
        </header>

        <label className="editor-field">
          <span>Name</span>
          <input
            className="editor-name"
            value={name}
            maxLength={40}
            autoFocus
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="editor-wave" ref={trackRef}>
          <canvas ref={canvasRef} style={{ width: "100%", height: WAVE_HEIGHT }} />
          <div className="editor-dim" style={{ left: 0, width: pct(edit.start) }} />
          <div className="editor-dim" style={{ left: pct(edit.end), right: 0 }} />
          <div className="editor-handle start" style={{ left: pct(edit.start) }} onPointerDown={dragHandle("start")} />
          <div className="editor-handle end" style={{ left: pct(edit.end) }} onPointerDown={dragHandle("end")} />
          {playhead !== null && <div className="editor-playhead" style={{ left: pct(playhead) }} />}
        </div>

        <div className="editor-transport">
          <button className="settings-button editor-play" onClick={togglePreview}>
            {playhead !== null ? "Stop" : "Preview"}
          </button>
          <span className="editor-times">
            {formatTime(edit.start)} to {formatTime(edit.end)} · {length.toFixed(1)}s
            {duration > MAX_SECONDS && ` (max ${MAX_SECONDS}s)`}
          </span>
        </div>

        <div className="settings-group editor-controls">
          <label className="settings-row">
            <span className="settings-row-label">Volume</span>
            <span className="editor-slider">
              <input
                type="range"
                min={0}
                max={2}
                step={0.01}
                value={edit.volume}
                onChange={(e) => setEdit({ ...edit, volume: Number(e.target.value) })}
              />
              <span className="editor-value">{Math.round(edit.volume * 100)}%</span>
            </span>
          </label>
          <label className="settings-row">
            <span className="settings-row-label">Fade in</span>
            <span className="editor-slider">
              <input
                type="range"
                min={0}
                max={maxFade}
                step={0.01}
                value={Math.min(edit.fadeIn, maxFade)}
                onChange={(e) => setEdit({ ...edit, fadeIn: Number(e.target.value) })}
              />
              <span className="editor-value">{edit.fadeIn.toFixed(2)}s</span>
            </span>
          </label>
          <label className="settings-row">
            <span className="settings-row-label">Fade out</span>
            <span className="editor-slider">
              <input
                type="range"
                min={0}
                max={maxFade}
                step={0.01}
                value={Math.min(edit.fadeOut, maxFade)}
                onChange={(e) => setEdit({ ...edit, fadeOut: Number(e.target.value) })}
              />
              <span className="editor-value">{edit.fadeOut.toFixed(2)}s</span>
            </span>
          </label>
        </div>

        {error && <p className="settings-error">{error}</p>}
        <div className="editor-actions">
          <button className="settings-button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="primary-button settings-done" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
