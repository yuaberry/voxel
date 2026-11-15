/**
 * A `<pre>` must never be able to widen its container.
 *
 * The owner's report: "every time I click Play on the server in the
 * Launcher, the screen expands showing the code that opens Minecraft, but
 * everything else stays in the small layout — totally bugged".
 *
 * The cause is a CSS trap, not a React bug. `DialogContent` is a **grid**
 * (`grid w-full max-w-lg`), and a single implicit column sizes to the
 * MIN-CONTENT of its items. A `<pre>` has `white-space: pre` — it does not
 * wrap — so its min-content width is the width of its LONGEST LINE. The
 * launcher's log prints the java command line that starts the game, which
 * runs to thousands of pixels. `max-w-md` caps the dialog BOX, but the grid
 * track follows the content: the log spilled out of the dialog while every
 * other row stayed narrow. Exactly the "expanded but everything else small"
 * the owner described.
 *
 * Two independent protections, both required by this test:
 *
 *  1. `whitespace-pre-wrap` — lines wrap instead of stretching the block;
 *  2. `min-w-0` — the item's automatic minimum size stops being its
 *     min-content, so a grid/flex track is no longer widened by it.
 *
 * A bounded, scrollable block (`max-w-*` + `overflow-auto`) is the one
 * legitimate alternative: it clips itself and can never widen anything.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (extname(full) === ".tsx") out.push(full);
  }
  return out;
}

describe("no <pre> can stretch its container", () => {
  const files = walk(join(ROOT, "src"));
  const offenders: string[] = [];
  let found = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      // a comment that MENTIONS <pre> is prose, not a block
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const at = line.indexOf("<pre");
      if (at === -1) return;
      found += 1;
      const classes = line.slice(at).match(/className="([^"]*)"/)?.[1] ?? "";
      const wraps = classes.includes("whitespace-pre-wrap");
      const zeroMin = classes.includes("min-w-0");
      const bounded = /max-w-/.test(classes) && classes.includes("overflow");
      if (!((wraps && zeroMin) || bounded)) {
        offenders.push(
          `${file}:${index + 1} — wraps=${wraps} min-w-0=${zeroMin} bounded=${bounded}`,
        );
      }
    });
  }

  it("finds the blocks it is supposed to guard", () => {
    expect(found).toBeGreaterThanOrEqual(6);
  });

  it("lets no unwrapped, unbounded <pre> through", () => {
    expect(
      offenders,
      `a <pre> without wrapping and without a zero minimum width widens its grid/flex track until the layout breaks:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});