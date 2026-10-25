/**
 * UI Scale (Phase G — Accessibility) — the clamps are the whole feature:
 * garbage never reaches the document, and the range stays inside what the
 * crafted layouts survive.
 */
import { describe, expect, it } from "vitest";
import { UI_SCALE_MAX, UI_SCALE_MIN, clampUiScale, uiScaleCss } from "./uiScale";

describe("UI Scale — accessibility with limits (§G)", () => {
  it("keeps the value inside the supported range", () => {
    expect(clampUiScale(1)).toBe(1);
    expect(clampUiScale(1.1)).toBe(1.1);
    expect(clampUiScale(0.75)).toBe(UI_SCALE_MIN); // too small — clamp up
    expect(clampUiScale(3)).toBe(UI_SCALE_MAX); // too big — clamp down
    expect(clampUiScale(UI_SCALE_MIN)).toBe(UI_SCALE_MIN);
    expect(clampUiScale(UI_SCALE_MAX)).toBe(UI_SCALE_MAX);
  });

  it("garbage falls back to 100% — the document never sees NaN", () => {
    expect(clampUiScale(Number.NaN)).toBe(1);
    // infinities are garbage too — the default, not a clamped extreme
    expect(clampUiScale(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampUiScale(Number.NEGATIVE_INFINITY)).toBe(1);
  });

  it("emits a tidy CSS value", () => {
    expect(uiScaleCss(1)).toBe("1.00");
    expect(uiScaleCss(0.9)).toBe("0.90");
    expect(uiScaleCss(99)).toBe("1.25");
  });
});
