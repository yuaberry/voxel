/**
 * Render smoke — the Mine Rank site is a NEW public surface. It renders the
 * very same manifest that generates the datapack inside the desktop app, so
 * a drift between the two would show up here as a wrong number, a broken
 * filter or an empty section.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { Commands } from "./components/Commands";
import {
  FAMILY_ORDER,
  MINE_RANK_COMMANDS,
  MINE_RANK_FAMILY_LABELS,
  MINE_RANK_PLOTS,
  PLOT_COLORS,
} from "./data";

afterEach(() => cleanup());

/**
 * Reads a file that lives NEXT TO this test, whatever form `import.meta.url`
 * takes (a file: URL under node, a bare path under jsdom — both happen here).
 */
function readSibling(relative: string): string {
  const url = import.meta.url;
  const full = url.startsWith("file:")
    ? new URL(relative, url).pathname
    : resolve(dirname(url), relative);
  return readFileSync(full, "utf8");
}

function siblingDir(relative: string): string {
  const url = import.meta.url;
  return url.startsWith("file:")
    ? new URL(relative, url).pathname
    : resolve(dirname(url), relative);
}

describe("Mine Rank site renders (no dead page)", () => {
  it("renders every section of the page", () => {
    render(<App />);

    expect(screen.getAllByText("MINE").length).toBeGreaterThan(0);
    // the sections the owner asked for: commands, progressão, mundo,
    // referência and the dedication to NerdZone.gg
    for (const id of [
      "comandos",
      "progressao",
      "mundo",
      "referencia",
      "prova",
      "dedicatoria",
    ]) {
      expect(document.getElementById(id), `missing section #${id}`).toBeTruthy();
    }
    expect(screen.getAllByText(/NerdZone/).length).toBeGreaterThan(0);
  });

  it("shows the REAL numbers of the manifest — never a hand-written one", () => {
    render(<App />);

    // the manifest decides the number: the section title, the hero and the
    // command counter all read it from the same array
    expect(screen.getAllByText(String(MINE_RANK_COMMANDS.length)).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(String(MINE_RANK_COMMANDS.length * 3)).length,
    ).toBeGreaterThan(0);
  });
});

/**
 * The honest surface — what the site says about itself must be TRUE.
 *
 * Three of these were false at the same time and nobody noticed, because
 * the page still rendered:
 *
 *  1. the section title said "39 comandos" while the same page counted 47
 *     (the site publicly contradicting its own product);
 *  2. the static metas in index.html repeated the same stale 39;
 *  3. a hand-written "test output" (with an invented 56s) was presented as
 *     the real E2E run, which is gated by VOXEL_E2E=1 and never runs in CI.
 */
describe("Mine Rank site — the honest surface", () => {
  it("titles the command section with the count of the manifest", () => {
    render(<App />);
    const title = `${MINE_RANK_COMMANDS.length} comandos, um único manifesto`;
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("39 comandos");
  });

  it("keeps the static metas of index.html free of hand-written counts", () => {
    // index.html imports NOTHING: any number written there is a number
    // waiting to drift (it said "39 comandos" for years while the page
    // counted 47). The honest fix is no count in the static metas at all —
    // the rendered page shows the real one, derived from the manifest.
    const html = readSibling("../index.html");
    const counts = [...html.matchAll(/(\d+)\s+comandos/g)].map((m) => Number(m[1]));
    expect(
      counts,
      "a static meta must not carry a command count it cannot derive",
    ).toEqual([]);
    // and the real count IS on the page, from the manifest
    render(<App />);
    expect(screen.getAllByText(String(MINE_RANK_COMMANDS.length)).length).toBeGreaterThan(0);
  });

  it("never claims a hand-written transcript is the real test output", () => {
    render(<App />);
    expect(screen.queryByText("saída do teste real")).toBeNull();
    expect(screen.getAllByText(/exemplo da saída do E2E/i).length).toBeGreaterThan(0);
  });

  it("keeps the section navigation reachable on a phone", () => {
    render(<App />);
    const nav = document.querySelector("nav");
    expect(nav).toBeTruthy();
    // the links were `hidden ... md:flex` with no hamburger: below 768px the
    // navigation simply did not exist
    expect(nav!.className).not.toContain("hidden");
    for (const href of ["#comandos", "#progressao", "#mundo", "#referencia", "#prova"]) {
      expect(
        document.querySelector(`nav a[href="${href}"]`),
        `the header must link ${href}`,
      ).toBeTruthy();
    }
  });

  it("links every rendered section from the footer too", () => {
    render(<App />);
    for (const href of ["#comandos", "#progressao", "#mundo", "#referencia", "#prova", "#dedicatoria"]) {
      const footer = document.querySelector("footer");
      expect(
        footer?.querySelector(`a[href="${href}"]`),
        `the footer must link ${href}`,
      ).toBeTruthy();
    }
  });

  /**
   * The Tailwind token guard.
   *
   * `text-warning`, `border-warning/30` and `bg-warning/5` were already in
   * the JSX of BOTH the site and the desktop app's Mine Rank panel, but
   * `warning` existed in neither tailwind.config.ts nor in index.css — so
   * every one of those classes compiled to NOTHING (verified: zero hits for
   * "warning" in the built CSS) and the panel silently lost its colour.
   */
  it("declares the warning token the components actually use", () => {
    const config = readSibling("../tailwind.config.ts");
    const css = readSibling("./index.css");
    expect(config).toMatch(/warning:\s*\{/);
    expect(config).toContain("hsl(var(--warning))");
    expect(css).toMatch(/--warning:\s*\d+/);

    // and every class that relies on it is still in use — if a component
    // stops using it, the token is dead weight and this test says so
    const sources = readdirSync(siblingDir("./components")).filter((f) =>
      f.endsWith(".tsx"),
    );
    const used = sources.filter((file) => {
      const source = readSibling(`./components/${file}`);
      return /(text|bg|border)-warning\b/.test(source);
    });
    expect(used.length, "no component uses the warning token anymore").toBeGreaterThan(0);
  });
});

describe("Mine Rank site — the command explorer", () => {
  it("lists every command of the manifest", () => {
    render(<Commands />);
    expect(screen.getByText(`${MINE_RANK_COMMANDS.length} de ${MINE_RANK_COMMANDS.length} comandos`)).toBeTruthy();
  });

  it("offers a filter chip for EVERY family the manifest declares", () => {
    // regression guard: a hand-written family list silently breaks the
    // filters (empty result for every chip)
    const manifestFamilies = [
      ...new Set(MINE_RANK_COMMANDS.map((command) => command.family)),
    ];
    expect([...FAMILY_ORDER].sort()).toEqual([...manifestFamilies].sort());

    render(<Commands />);
    for (const family of FAMILY_ORDER) {
      expect(screen.getByText(MINE_RANK_FAMILY_LABELS[family])).toBeTruthy();
    }
  });

  it("filters by family and by search", () => {
    render(<Commands />);

    const family = FAMILY_ORDER[0];
    const familyCommands = MINE_RANK_COMMANDS.filter(
      (command) => command.family === family,
    );
    fireEvent.click(screen.getByText(MINE_RANK_FAMILY_LABELS[family]));
    expect(
      screen.getByText(
        `${familyCommands.length} de ${MINE_RANK_COMMANDS.length} comandos`,
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Todas"));
    const input = screen.getByLabelText("Buscar comando") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "prestigio" } });
    expect(input.value).toBe("prestigio");
    expect(
      screen.getByText(new RegExp(`de ${MINE_RANK_COMMANDS.length} comandos`)),
    ).toBeTruthy();
  });
});

describe("Mine Rank site — the world map", () => {
  it("draws one marker per plot, with the color of the real wool block", () => {
    expect(PLOT_COLORS).toHaveLength(MINE_RANK_PLOTS);
    for (const color of PLOT_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }

    render(<App />);
    const map = document.querySelector("svg[role='img']");
    expect(map).toBeTruthy();
    // the legend names every area of the world
    expect(screen.getAllByText(/hub \(spawn\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/terreno com mina/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/lago/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/arena/i).length).toBeGreaterThan(0);
  });
});
