/**
 * Accessibility - Skip to Content Link.
 *
 * Link oculto que aparece no foco quando o usuário navega por teclado,
 * permitindo pular diretamente para o conteúdo principal da página.
 * Útil para usuários de teclado e leitores de tela.
 *
 * @param href - ID do elemento de destino (ex: "#main-content")
 * @param label - Texto exibido no link
 *
 * @example
 *   <SkipLink href="#main-content">Pular para o conteúdo principal</SkipLink>
 */
import { useState } from "react";

export function SkipLink({
  href = "#main-content",
  label = "Pular para o conteúdo principal",
}: {
  href?: string;
  label?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <a
      href={href}
      className={`
        fixed top-4 left-4 z-50 -translate-y-full transition-transform duration-200
        ${isFocused ? "translate-y-0" : ""}
        bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium shadow-lg
      `}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      {label}
    </a>
  );
}
