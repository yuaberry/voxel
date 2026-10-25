/**
 * UI Scale (Phase G — Accessibility): the interface-level zoom preference.
 * Pure functions only — the store applies, the tests verify the clamps.
 * The range is deliberately narrow (85%–125%): the layouts are crafted at
 * 100%, and an extreme zoom would break dialogs — the setting is a comfort
 * aid, not a liability.
 */

export const UI_SCALE_MIN = 0.85;
export const UI_SCALE_MAX = 1.25;
export const UI_SCALE_DEFAULT = 1;

/** Clamps to the supported range; NaN and garbage fall back to 100%. */
export function clampUiScale(raw: number): number {
  if (!Number.isFinite(raw)) return UI_SCALE_DEFAULT;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, raw));
}

/** The value applied to the document (2 decimals — CSS likes it tidy). */
export function uiScaleCss(raw: number): string {
  return clampUiScale(raw).toFixed(2);
}
