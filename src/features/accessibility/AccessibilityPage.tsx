/**
 * Accessibility Page (/accessibility).
 *
 * Página de testes e demonstração de acessibilidade.
 * Permite ao dono testar contraste de cores, navegação por teclado,
 * leitores de tela e outras funcionalidades de acessibilidade.
 *
 * Toda a página é construída com componentes de acessibilidade reutilizáveis
 * que podem ser usados em qualquer parte do app.
 */

import { useState } from "react";
import { t } from "@/i18n";
import { SkipLink } from "@/components/accessibility/SkipLink";
import { LiveRegion, useLiveRegion } from "@/components/accessibility/LiveRegion";
import { FocusVisible } from "@/components/accessibility/FocusVisible";
import { ContrastTester } from "@/components/accessibility/ContrastTester";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function AccessibilityPage() {
  const [announceMessage, setAnnounceMessage] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { announce } = useLiveRegion();

  const announceTest = () => {
    announce(announceMessage);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      {/* Skip link */}
      <SkipLink href="#main-content" label="Pular para o conteúdo principal" />

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="bg-gradient-to-r from-brand-purple to-brand-cyan bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
            {t("Accessibility")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t("Teste e melhore a acessibilidade do VOXEL")}
          </p>
        </div>
        <Badge variant="outline">
          {t("WCAG 2.1 AA")}
        </Badge>
      </div>

      {/* Skip Link Demo */}
      <Card title={t("Skip to Content")}>
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            {t("Pressione Tab para navegar até o link 'Pular para o conteúdo' no topo da página")}
          </p>
          <SkipLink href="#main-content" label="Pular para o conteúdo principal" />
        </div>
      </Card>

      {/* Contrast Tester */}
      <Card title={t("Color Contrast")}>
        <div className="space-y-4">
          <ContrastTester />
        </div>
      </Card>

      {/* Live Region */}
      <Card title={t("Live Region / Announcements")}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder={t("Message to announce")}
              value={announceMessage}
              onChange={(e) => setAnnounceMessage(e.target.value)}
              className="flex-1"
            />
            <Button
              size="sm"
              variant="gradient"
              onClick={() => announceTest()}
            >
              {t("Announce")}
            </Button>
          </div>
          <LiveRegion>{announceMessage}</LiveRegion>
          <p className="text-[11px] text-muted-foreground">
            {t("O texto acima será anunciado para leitores de tela")}
          </p>
        </div>
      </Card>

      {/* Keyboard Navigation */}
      <Card title={t("Keyboard Navigation")}>
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            {t("Use as setas direcionais para navegar pelos itens abaixo")}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              Item 1
            </Button>
            <Button variant="outline" size="sm">
              Item 2
            </Button>
            <Button variant="outline" size="sm">
              Item 3
            </Button>
          </div>
        </div>
      </Card>

      {/* Escape Key */}
      <Card title={t("Escape Key")}>
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            {t("Pressione Esc para fechar este diálogo")}
          </p>
          <Button variant="outline" size="sm" onClick={() => setIsDialogOpen(true)}>
            {t("Open Test Dialog")}
          </Button>
        </div>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogTitle>{t("Test Dialog")}</DialogTitle>
          <DialogHeader>{t("Press Escape to close this dialog")}</DialogHeader>
        </DialogContent>
      </Dialog>

      {/* Focus Visible */}
      <Card title={t("Focus Visible")}>
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            {t("Navigate with Tab to see focus indicators")}
          </p>
          <FocusVisible>
            <Button variant="outline" size="sm">
              Button 1
            </Button>
          </FocusVisible>
          <FocusVisible>
            <Button variant="outline" size="sm">
              Button 2
            </Button>
          </FocusVisible>
        </div>
      </Card>
    </div>
  );
}
