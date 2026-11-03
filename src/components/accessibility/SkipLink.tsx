/**
 * Accessibility - Skip to Content Link.
 *
 * Link oculto que aparece no foco quando o usuário navega por teclado,
 * permitindo pular diretamente para o conteúdo principal da página.
 * Útil para usuários de teclado e leitores de tela.
 *
 * Duas decisões importantes:
 * - `top-0` + `-translate-y-full` esconde o link POR INTEIRO. Com `top-4`
 *   sobrava uma faixa visível de 16px no topo da janela (bug reportado).
 * - O clique é tratado aqui: o app usa HashRouter, então um href="#..."
 *   puro seria interpretado como rota e derrubaria a navegação atual.
 *
 * @param href - ID do elemento de destino (ex: "#main-content")
 * @param label - Texto exibido no link
 *
 * @example
 *   <SkipLink />
 *   <SkipLink href="#main-content" label="Ir para o conteúdo" />
 */
import type { MouseEvent } from "react";
import { t } from "@/i18n";

export function SkipLink({
  href = "#main-content",
  label = t("Skip to main content"),
}: {
  href?: string;
  label?: string;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!href.startsWith("#")) return;
    // HashRouter owns the URL hash — never let the anchor rewrite it.
    event.preventDefault();
    const target = document.getElementById(href.slice(1));
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "start" });
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      className="fixed left-4 top-0 z-[80] -translate-y-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground shadow-lg transition-transform duration-200 focus:translate-y-4 motion-reduce:transition-none"
    >
      {label}
    </a>
  );
}
