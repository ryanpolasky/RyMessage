import { getSound } from "./soundLibrary";

export const CHIME = "chime";
export const SILENT = "none";

interface Playing {
  out: GainNode;
  sources: AudioScheduledSourceNode[];
}

let context: AudioContext | null = null;
let current: Playing | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

export function audioContext(): AudioContext {
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
  return context;
}

export function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  return audioContext().decodeAudioData(data);
}

export function forgetSound(id: string): void {
  buffers.delete(id);
}

function loadBuffer(id: string): Promise<AudioBuffer | null> {
  let pending = buffers.get(id);
  if (!pending) {
    pending = getSound(id).then(async (sound) => (sound ? decodeAudio(await sound.blob.arrayBuffer()) : null));
    buffers.set(id, pending);
    pending.catch(() => buffers.delete(id));
  }
  return pending;
}

function track(out: GainNode, sources: AudioScheduledSourceNode[]) {
  const playing = { out, sources };
  current = playing;
  let remaining = sources.length;
  for (const source of sources) {
    source.onended = () => {
      remaining -= 1;
      if (remaining === 0 && current === playing) current = null;
    };
  }
}

function playChime() {
  const ctx = audioContext();
  const now = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.2;
  out.connect(ctx.destination);
  const notes: [number, number][] = [
    [1046.5, 0],
    [1568, 0.11],
  ];
  const partials: [number, number, number][] = [
    [1, 1, 0.9],
    [2.76, 0.12, 0.3],
  ];
  const sources: OscillatorNode[] = [];
  for (const [frequency, at] of notes) {
    for (const [ratio, level, decay] of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency * ratio;
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(level, now + at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + decay);
      osc.connect(gain).connect(out);
      osc.start(now + at);
      osc.stop(now + at + decay + 0.05);
      sources.push(osc);
    }
  }
  track(out, sources);
}

function playBuffer(buffer: AudioBuffer) {
  const ctx = audioContext();
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(out);
  source.start();
  track(out, [source]);
}

export function stopNotificationSound(): void {
  if (!current || !context) return;
  const { out, sources } = current;
  current = null;
  const now = context.currentTime;
  out.gain.cancelScheduledValues(now);
  out.gain.setValueAtTime(out.gain.value, now);
  out.gain.linearRampToValueAtTime(0, now + 0.08);
  for (const source of sources) source.stop(now + 0.1);
}

export async function playNotificationSound(choice: string): Promise<void> {
  stopNotificationSound();
  if (choice === SILENT) return;
  if (choice === CHIME) return playChime();
  const buffer = await loadBuffer(choice).catch((e) => {
    console.warn("Failed to load notification sound", e);
    return null;
  });
  if (!buffer) {
    console.warn("Selected notification sound is missing; playing the chime instead");
    return playChime();
  }
  playBuffer(buffer);
}
