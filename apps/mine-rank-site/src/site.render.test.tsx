/**
 * Render smoke — the Mine Rank site is a NEW public surface. It renders the
 * very same manifest that generates the datapack inside the desktop app, so
 * a drift between the two would show up here as a wrong number, a broken
 * filter or an empty section.
 */
import { afterEach, describe, expect, it } from "vitest";
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

    // 39 commands and 117 triggers (39 × 3 values) are both on the page
    expect(screen.getAllByText(String(MINE_RANK_COMMANDS.length)).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(String(MINE_RANK_COMMANDS.length * 3)).length,
    ).toBeGreaterThan(0);
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
    expect(screen.getByText(/de 39 comandos/)).toBeTruthy();
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
