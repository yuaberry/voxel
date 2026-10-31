/**
 * Accessibility - Contrast Tester UI.
 *
 * Componente para testar contraste de cores em tempo real.
 * Útil para verificar se combinações de cores atendem aos padrões WCAG 2.1.
 */

import { useState } from "react";
import { getContrastRatio } from "./contrast";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ContrastTester() {
  const [foreground, setForeground] = useState("#FFFFFF");
  const [background, setBackground] = useState("#000000");

  const result = getContrastRatio(foreground, background);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-2">
          <Label>Foreground</Label>
          <Input
            type="color"
            value={foreground}
            onChange={(e) => setForeground(e.target.value)}
            className="h-10 w-16 cursor-pointer"
          />
          <Input
            type="text"
            value={foreground}
            onChange={(e) => setForeground(e.target.value)}
            className="h-8 text-xs text-center"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Background</Label>
          <Input
            type="color"
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            className="h-10 w-16 cursor-pointer"
          />
          <Input
            type="text"
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            className="h-8 text-xs text-center"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 rounded-lg border p-4" style={{ backgroundColor: background }}>
          <div className="flex-1 min-h-32 rounded-lg border p-4" style={{ backgroundColor: foreground }}>
            <span className="text-sm font-medium">{foreground}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{result.ratio}:1</span>
            <Badge variant={result.passesAA ? "success" : "destructive"}>
              {result.passesAA ? "AA" : "Fail AA"}
            </Badge>
            <Badge variant={result.passesAALarge ? "success" : "secondary"}>
              {result.passesAALarge ? "AA Large" : "Fail AA Large"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            WCAG 2.1: {result.passesAA ? "✓ Passes AA (4.5:1)" : "✗ Fails AA (need 4.5:1)"} —
            {result.passesAALarge ? "✓ Passes AA Large (3:1)" : "✗ Fails AA Large (need 3:1)"}
          </p>
        </div>
      </div>
    </div>
  );
}
