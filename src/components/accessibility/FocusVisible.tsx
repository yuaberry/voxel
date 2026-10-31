/**
 * Accessibility - Focus Visible Indicator.
 *
 * Adiciona um anel de foco visível quando o usuário está navegando por teclado.
 * Detecta automaticamente quando o usuário muda de mouse para teclado.
 *
 * @param children - Elemento envolto pelo indicador de foco
 *
 * @example
 *   <FocusVisible>
 *     <button>Meu Botão</button>
 *   </FocusVisible>
 */
import { useEffect, useState, useRef } from "react";

export function FocusVisible({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isKeyboard, setIsKeyboard] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        setIsKeyboard(true);
      }
    };

    const handleMouseDown = () => {
      setIsKeyboard(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      {isKeyboard && (
        <span className="absolute -inset-1 rounded-md ring-2 ring-primary ring-offset-2 pointer-events-none" />
      )}
      {children}
    </div>
  );
}
