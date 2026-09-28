export function normalizeHandle(handle: string): string {
  const trimmed = handle.trim().toLowerCase();
  if (trimmed.includes("@")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length === 10 ? `1${digits}` : digits;
}

export function looksLikeHandle(input: string): boolean {
  const value = input.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true;
  return /^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 7;
}
