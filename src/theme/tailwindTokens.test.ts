/**
 * The design tokens exist.
 *
 * The Mine Rank panel (the console tab the owner opens to install the
 * datapack) drew two boxes with `border-warning/30` / `bg-warning/5` /
 * `text-warning` and `border-success/30` / `bg-success/5` / `text-success`
 * — and NEITHER `warning` NOR `success` was declared in
 * `tailwind.config.ts` or `src/index.css`. Tailwind compiles an unknown
 * token to nothing, so both boxes silently lost their border, their
 * background and their title colour: no error, no warning, the panel just
 * looked flat. The same dead `warning` token existed on the Mine Rank site.
 *
 * All three tokens are fixed; this test is the guard. It scans the real JSX
 * (instead of trusting a hand-written list of tokens) and only judges the
 * classes that are actually single colour tokens — `bg-clip-text` is a
 * Tailwind utility, and `nexus.purple` is a scale with literal hex values
 * that legitimately has no CSS variable.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CONFIG = readFileSync(join(ROOT, "tailwind.config.ts"), "utf8");
const CSS = readFileSync(join(ROOT, "src/index.css"), "utf8");

/** Every .tsx under src/, recursively. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (extname(full) === ".tsx") out.push(full);
  }
  return out;
}

/**
 * Colour tokens the app really uses, in `token => where` form.
 *
 * Only a class that ENDS in a bare token (`text-warning`, `bg-warning/5`,
 * `border-warning/30`) is a colour of ours. `bg-clip-text`,
 * `bg-gradient-to-r` and `from-nexus-cyan` carry another segment after the
 * prefix — they are Tailwind utilities, gradient stops or the app's own
 * colour scale, not a `--token` the config has to declare.
 */
function tokensUsedIn(files: string[]): Map<string, string> {
  const used = new Map<string, string>();
  // the prefixes that take a COLOUR. `from/to/via` are left out on purpose:
  // their values are colour SCALES (`from-nexus-cyan`, skipped by the dash
  // rule anyway) and prose like "end-to-end" / "back-to-front" would
  // otherwise read as a token called "end".
  const CLASS =
    /\b(?:text|bg|border|ring|fill|stroke|shadow|outline|decoration|accent|caret|divide|placeholder)-[a-z][a-z0-9_-]*(?:\/\d+)?\b/g;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      // comments and JSDoc are prose, not classes
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      for (const match of line.matchAll(CLASS)) {
        const token = match[0].replace(/^(?:[a-z]+)-/, "").replace(/\/\d+$/, "");
        if (token.includes("-")) continue; // a scale or a multi-word utility
        if (!used.has(token)) used.set(token, `${file}:${index + 1}`);
      }
    }
  }
  return used;
}

/** The tokens registered in the Tailwind config, with their raw value. */
function tokensInConfig(): Map<string, string> {
  const declared = new Map<string, string>();
  const block = CONFIG.slice(CONFIG.indexOf("colors:"));
  // `name: "..."` or `name: {`
  for (const match of block.matchAll(/([a-zA-Z][\w-]*):\s*(?:"([^"]+)"|\{)/g)) {
    declared.set(match[1], match[2] ?? "");
  }
  return declared;
}

describe("the Tailwind tokens the JSX uses are declared", () => {
  const files = walk(join(ROOT, "src"));
  const used = tokensUsedIn(files);
  const declared = tokensInConfig();

  // Tailwind's own palette + utilities that share the class prefixes above
  const notOurs = new Set([
    "left", "right", "center", "top", "bottom", "none", "full", "auto", "transparent",
    "current", "inherit", "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "white", "black",
    "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow",
    "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet",
    "purple", "fuchsia", "pink", "rose", "clip", "gradient", "opacity", "solid",
    "dashed", "dotted", "double", "hidden", "visible", "ellipsis", "wrap", "nowrap",
    "uppercase", "lowercase", "capitalize", "normal", "mono", "sans", "serif",
    "bold", "semibold", "medium", "extrabold", "tracking", "leading",
    // border-WIDTH utilities, not colours: border-b, border-r, border-x…
    "b", "r", "t", "l", "x", "y", "s", "e", "0", "2", "4", "8",
  ]);

  it("finds the usage it is supposed to guard", () => {
    expect(used.has("warning"), "the panel still uses text-warning").toBe(true);
    expect(used.has("success"), "the panel still uses text-success").toBe(true);
    expect(used.has("primary")).toBe(true);
    expect(declared.size).toBeGreaterThan(10);
  });

  it("declares every colour token the app uses", () => {
    const missing = [...used].filter(
      ([token]) => !declared.has(token) && !notOurs.has(token),
    );
    expect(
      missing,
      `a class whose token is not declared compiles to NOTHING — the panel loses its colours in silence: ${missing
        .map(([t, w]) => `${t} (${w})`)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("defines the CSS variable of every token that reads one", () => {
    // the config maps `warning: "hsl(var(--warning))"` — the variable must
    // exist in index.css or the token resolves to nothing in the browser.
    // A token with a literal value (`nexus.purple`) needs no variable.
    const readFromCss = [...declared].filter(([, value]) => value.includes("var(--"));
    expect(readFromCss.length).toBeGreaterThan(5);
    for (const [token, value] of readFromCss) {
      const variable = value.match(/var\((--[\w-]+)\)/)?.[1];
      expect(variable, `${token} reads a css variable`).toBeTruthy();
      expect(
        CSS.includes(`${variable}:`),
        `${token} → ${variable} is not defined in src/index.css`,
      ).toBe(true);
    }
  });
});