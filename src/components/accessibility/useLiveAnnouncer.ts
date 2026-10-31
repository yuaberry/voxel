/**
 * Accessibility - Live Announcer.
 *
 * Anuncia mudanças dinâmicas para leitores de tela sem mover o foco.
 * Útil para notificações, mudanças de estado, resultados de busca, etc.
 *
 * @param message - Mensagem a ser anunciada
 * @param priority - "polite" (aguarda pausas) ou "assertive" (imediato)
 *
 * @example
 *   const { announce } = useLiveAnnouncer();
 *   announce("Servidor iniciado com sucesso");
 */
import { useCallback, useRef, useEffect } from "react";

export function useLiveAnnouncer() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      ref.current = document.createElement("div");
      ref.current.setAttribute("role", "status");
      ref.current.setAttribute("aria-live", "polite");
      ref.current.setAttribute("aria-atomic", "true");
      ref.current.className = "sr-only";
      document.body.appendChild(ref.current);
      return () => {
        document.body.removeChild(ref.current!);
        ref.current = null;
      };
    }
  }, []);

  const announce = useCallback(
    (message: string, priority: "polite" | "assertive" = "polite") => {
      if (!ref.current) return;
      ref.current.setAttribute("aria-live", priority);
      ref.current.textContent = "";
      // Force re-read by clearing then setting after a tick
      requestAnimationFrame(() => {
        ref.current!.textContent = message;
      });
    },
    [],
  );

  return { announce };
}
