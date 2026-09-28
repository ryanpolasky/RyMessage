const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

export function prefersReducedMotion(): boolean {
  return reducedMotionQuery.matches;
}

export const EASE_OUT_EXPO = "cubic-bezier(0.32, 0.72, 0, 1)";
