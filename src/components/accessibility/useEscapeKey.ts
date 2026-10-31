/**
 * Accessibility - UseEscapeKey hook.
 *
 * Permite fechar modais, diálogos e painéis pressionando a tecla Esc.
 * Útil para melhorar a acessibilidade por teclado em qualquer componente.
 *
 * @param callback - Função chamada quando Esc é pressionado
 * @param enabled - Se o hook deve estar ativo
 *
 * @example
 *   useEscapeKey(() => setIsOpen(false), isOpen);
 */
import { useEffect } from "react";

export function useEscapeKey(
  callback: () => void,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        callback();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [callback, enabled]);
}
