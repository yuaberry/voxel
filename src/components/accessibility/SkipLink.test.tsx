// @vitest-environment jsdom
/**
 * Regression tests for the owner's "floating blue card" report.
 *
 * The link used `top-4` + `-translate-y-full`: translating by its own height
 * left 16px of the blue pill permanently visible above the app. It also used
 * a raw `#main-content` href inside a HashRouter — activating it rewrote the
 * route instead of focusing the main landmark.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setLanguage } from "@/i18n";
import { SkipLink } from "./SkipLink";

beforeEach(() => {
  window.location.hash = "";
  setLanguage("pt-BR");
});

afterEach(() => {
  cleanup();
  document.getElementById("main-content")?.remove();
});

function link() {
  return screen.getByRole("link", { name: "Pular para o conteúdo principal" });
}

describe("SkipLink", () => {
  it("stays fully off-screen until it receives focus", () => {
    render(<SkipLink />);
    const anchor = link();
    expect(anchor.className).toContain("top-0");
    expect(anchor.className).toContain("-translate-y-full");
    expect(anchor.className).toContain("focus:translate-y-4");
    // the old top offset was what left a visible strip behind
    expect(anchor.className).not.toContain("top-4");
  });

  it("focuses the main landmark without touching the hash route", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.appendChild(main);

    render(<SkipLink />);
    fireEvent.click(link());

    expect(document.activeElement).toBe(main);
    expect(window.location.hash).toBe("");
  });

  it("accepts a custom target and label", () => {
    const target = document.createElement("div");
    target.id = "content";
    target.tabIndex = -1;
    document.body.appendChild(target);

    render(<SkipLink href="#content" label="Ir para o conteúdo" />);
    fireEvent.click(screen.getByRole("link", { name: "Ir para o conteúdo" }));

    expect(document.activeElement).toBe(target);
    target.remove();
  });
});
