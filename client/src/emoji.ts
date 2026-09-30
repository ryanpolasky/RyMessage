import type { Emoji, ShortcodesDataset } from "emojibase";

export interface EmojiOption {
  char: string;
  name: string;
  codes: string[];
  tags: string[];
  skins: string[];
}

export interface CodeMatch {
  code: string;
  emoji: EmojiOption;
}

export interface EmojiSection {
  key: string;
  label: string;
  icon: string;
  emojis: EmojiOption[];
}

export interface EmojiIndex {
  sections: EmojiSection[];
  search(query: string): EmojiOption[];
  searchCodes(query: string, limit: number): CodeMatch[];
}

const SECTION_ICONS: Record<string, string> = {
  "smileys-emotion": "😀",
  "people-body": "🧑",
  "animals-nature": "🐻",
  "food-drink": "🍔",
  "travel-places": "✈️",
  activities: "⚽",
  objects: "💡",
  symbols: "❤️",
  flags: "🏁",
};

const RECENTS_KEY = "rymessage.emojiRecents";
const TONE_KEY = "rymessage.emojiTone";
const MAX_RECENTS = 24;

let indexPromise: Promise<EmojiIndex> | null = null;

export function loadEmojiIndex(): Promise<EmojiIndex> {
  indexPromise ??= buildIndex();
  return indexPromise;
}

async function buildIndex(): Promise<EmojiIndex> {
  const [data, messages, github, iamcal] = await Promise.all([
    import("emojibase-data/en/data.json"),
    import("emojibase-data/en/messages.json"),
    import("emojibase-data/en/shortcodes/github.json"),
    import("emojibase-data/en/shortcodes/iamcal.json"),
  ]);
  const emojis = data.default.filter(
    (e) => e.type === 1 && e.group !== undefined && e.group !== 2 && e.order !== undefined
  );
  emojis.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const byHex = new Map(emojis.map((e) => [e.hexcode, e]));

  // preset files map hexcode to names, which is backwards from what we need
  const codesByHex = new Map<string, string[]>();
  for (const preset of [github.default, iamcal.default] as ShortcodesDataset[]) {
    for (const [hex, names] of Object.entries(preset)) {
      if (!byHex.has(hex)) continue;
      const list = codesByHex.get(hex) ?? [];
      for (const name of Array.isArray(names) ? names : [names]) {
        if (!list.includes(name)) list.push(name);
      }
      codesByHex.set(hex, list);
    }
  }

  const toOption = (e: Emoji): EmojiOption => ({
    char: e.emoji,
    name: e.label,
    codes: codesByHex.get(e.hexcode) ?? [],
    tags: e.tags ?? [],
    skins: (e.skins ?? []).map((s) => s.emoji),
  });
  const options = emojis.map(toOption);
  const groups = [...messages.default.groups]
    .sort((a, b) => a.order - b.order)
    .filter((g) => g.key !== "component");
  const optionsByHex = new Map(
    options.map((o, i) => [emojis[i].hexcode, o])
  );
  const sections = groups
    .map((g) => ({
      key: g.key,
      label: titleCase(g.message),
      icon: SECTION_ICONS[g.key] ?? "🔎",
      emojis: emojis
        .filter((e) => e.group === g.order)
        .map((e) => optionsByHex.get(e.hexcode)!),
    }))
    .filter((s) => s.emojis.length > 0);

  function search(query: string): EmojiOption[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const ranked: { option: EmojiOption; score: number }[] = [];
    for (const option of options) {
      const name = option.name.toLowerCase();
      let score = -1;
      if (name === q || option.codes.includes(q)) score = 0;
      else if (name.startsWith(q) || option.codes.some((c) => c.startsWith(q))) score = 1;
      else if (name.includes(q) || option.codes.some((c) => c.includes(q))) score = 2;
      else if (option.tags.some((t) => t.startsWith(q))) score = 3;
      if (score >= 0) ranked.push({ option, score });
    }
    return ranked
      .sort((a, b) => a.score - b.score)
      .slice(0, 60)
      .map((r) => r.option);
  }

  function searchCodes(query: string, limit: number): CodeMatch[] {
    const q = query.toLowerCase();
    const hits: { match: CodeMatch; score: number }[] = [];
    for (const option of options) {
      for (const code of option.codes) {
        let score = -1;
        if (code === q) score = 0;
        else if (code.startsWith(q)) score = 1;
        else if (code.includes(q)) score = 2;
        if (score >= 0) hits.push({ match: { code, emoji: option }, score });
      }
    }
    return hits
      .sort((a, b) => a.score - b.score || a.match.code.length - b.match.code.length)
      .slice(0, limit)
      .map((h) => h.match);
  }

  return { sections, search, searchCodes };
}

function titleCase(text: string): string {
  return text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function getRecentEmojis(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecentEmoji(char: string): string[] {
  const next = [char, ...getRecentEmojis().filter((c) => c !== char)].slice(0, MAX_RECENTS);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  return next;
}

export function getEmojiTone(): number {
  const tone = Number(localStorage.getItem(TONE_KEY) ?? 0);
  return tone >= 1 && tone <= 5 ? tone : 0;
}

export function setEmojiTone(tone: number): void {
  localStorage.setItem(TONE_KEY, String(tone));
}

export function withTone(option: EmojiOption, tone: number): string {
  return tone > 0 && option.skins[tone - 1] ? option.skins[tone - 1] : option.char;
}
