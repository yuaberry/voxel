/**
 * Accessibility - Color Contrast Tester.
 *
 * Testa se a combinação de cores de primeiro plano e fundo atende aos
 * padrões de contraste WCAG 2.1 (AA: 4.5:1 para texto normal, 3:1 para texto grande).
 *
 * Retorna o ratio de contraste e se passa ou não.
 *
 * @param foreground - Cor do texto (hex, ex: #FFFFFF)
 * @param background - Cor de fundo (hex, ex: #000000)
 * @returns { ratio: number, passesAA: boolean, passesAALarge: boolean }
 */
export function getContrastRatio(
  foreground: string,
  background: string,
): {
  ratio: number;
  passesAA: boolean;
  passesAALarge: boolean;
} {
  const getLuminance = (hex: string): number => {
    const rgb = hex
      .replace("#", "")
      .match(/.{2}/g)
      ?.map((c) => parseInt(c, 16) / 255) ?? [0, 0, 0];
    const sRGB = rgb.map((c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
    );
    return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
  };

  const lum1 = getLuminance(foreground);
  const lum2 = getLuminance(background);
  const ratio = (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);

  return {
    ratio: Math.round(ratio * 100) / 100,
    passesAA: ratio >= 4.5,
    passesAALarge: ratio >= 3,
  };
}
