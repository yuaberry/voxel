import { useState } from "react";
import { t } from "@/i18n";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  pickBriefingDocuments,
  type ImportedBriefing,
} from "@/services/documents/documentsService";

/**
 * Briefing picker — the user's OWN documents (.txt/.md/.pdf/.docx, the
 * formats Google Drive ships) become part of the project/server intent:
 * the text is extracted for real (Rust) and the agent reads it as design
 * truth. Held in memory during wizards; persisted by the parent once the
 * target folder exists.
 */
export function BriefingPicker({
  docs,
  onChange,
  hint,
}: {
  docs: { fileName: string; kind: string; text: string }[];
  onChange: (docs: { fileName: string; kind: string; text: string }[]) => void;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const picked = await pickBriefingDocuments();
      if (picked.length > 0) {
        // same-name imports replace, different ones stack — max 8 honest docs
        const merged = [...docs.filter((d) => !picked.some((p) => p.fileName === d.fileName)), ...picked];
        onChange(merged.slice(0, 8));
        toast.success(
          picked.length === 1
            ? `Imported "${picked[0].fileName}"`
            : `Imported ${picked.length} documents`,
          {
            description:
              "The text was extracted for real — the agent reads it as design intent.",
          },
        );
      }
    } catch (error) {
      toast.error("Could not import that document", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void pick()} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          {t("Import briefing (.txt, .md, .pdf, .docx)")}
        </Button>
        <span className="text-[10px] leading-relaxed text-muted-foreground">
          {hint ??
            t(
              "Your own docs guide the build — a Google-Drive-style file becomes the design truth the agent follows.",
            )}
        </span>
      </div>
      {docs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {docs.map((doc, i) => (
            <span
              key={`${doc.fileName}-${i}`}
              className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px]"
            >
              <FileText className="h-3 w-3 text-primary" />
              <span className="max-w-44 truncate">{doc.fileName}</span>
              <span className="text-muted-foreground uppercase">.{doc.kind}</span>
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-destructive"
                onClick={() => onChange(docs.filter((_, j) => j !== i))}
                title={t("Remove")}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export type { ImportedBriefing };
