/**
 * i18n — the honest kind: `t("English text")` looks the string up in the
 * active dictionary (pt-BR ships complete) and falls back to the English
 * itself when a string hasn't been translated yet — the UI never shows a
 * broken key. "auto" follows the OS language.
 */

import { ptBR } from "./ptBR";

export type Language = "en" | "pt-BR";
export type LanguageSetting = "auto" | Language;

const DICTS: Record<Language, Record<string, string>> = {
  en: {},
  "pt-BR": ptBR,
};

let active: Language = resolveInitial();

function resolveInitial(): Language {
  if (typeof navigator !== "undefined") {
    const langs = navigator.languages ?? [navigator.language];
    for (const l of langs) {
      if (l?.toLowerCase().startsWith("pt")) return "pt-BR";
    }
  }
  return "en";
}

export function resolveLanguage(setting: LanguageSetting): Language {
  if (setting === "auto") return resolveInitial();
  return setting;
}

export function setLanguage(setting: LanguageSetting): void {
  active = resolveLanguage(setting);
}

export function currentLanguage(): Language {
  return active;
}

/**
 * Translate a UI string. Pass the English text — the dictionary maps it to
 * the active language; untranslated strings render the English as-is, so
 * coverage can grow incrementally without breaking anything.
 */
export function t(text: string): string {
  const dict = DICTS[active];
  return dict[text] ?? text;
}
