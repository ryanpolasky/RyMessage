const KEYWORDS =
  /\b(code|codes|passcode|pin|otp|verification|verify|one[- ]?time|2fa|mfa|security|log[- ]?in|sign[- ]?in|confirm(?:ation)?|authenticat\w*|password)\b/i;
const CANDIDATE = /(?<![\d$€£.,-])(?:\b[A-Z]{1,3}-)?\b(\d{3}[- ]\d{3}|\d{4,8})\b(?!%|[.,]\d)/g;

function preference(code: string): number {
  if (code.length === 6) return 0;
  if (code.length === 5) return 1;
  return 2;
}

export function formatVerificationCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function findVerificationCode(text: string | null): string | null {
  if (!text || !KEYWORDS.test(text)) return null;
  let best: string | null = null;
  for (const match of text.matchAll(CANDIDATE)) {
    const code = match[1].replace(/[- ]/g, "");
    if (best === null || preference(code) < preference(best)) best = code;
  }
  return best;
}
