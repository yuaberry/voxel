import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { useLocation } from "react-router-dom";
import { BookMarked, ExternalLink, FileSearch, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KNOWLEDGE_BASE, searchKnowledge, type KnowledgeArticle } from "@/services/knowledge/knowledgeBase";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<KnowledgeArticle["category"], string> = {
  eras: "Minecraft eras",
  loaders: "Loaders",
  datapacks: "Datapacks",
  build: "Build",
  servers: "Servers",
  launcher: "Launcher",
  ai: "AI",
};

/**
 * Knowledge Center (§11) — verified technical knowledge: every article
 * states HOW it was verified (our E2Es, our production datapacks) and
 * links its official sources. Searchable; error categories link here.
 */
export function KnowledgePage() {
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const state = location.state as { q?: string } | null;
    if (state?.q) {
      setQuery(state.q);
      const found = searchKnowledge(state.q);
      if (found[0]) setExpanded(found[0].id);
    }
  }, [location.state]);

  const results = query.trim().length >= 2 ? searchKnowledge(query) : KNOWLEDGE_BASE;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div>
        <h1 className="bg-gradient-to-r from-brand-purple to-brand-cyan bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
          {t("Knowledge Center")}
        </h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {t(
            "Verified technical knowledge: every article states how it was proven (our E2E builds, our production datapacks) and links its official sources. No invented APIs, no outdated examples.",
          )}
        </p>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <FileSearch className="h-4 w-4 shrink-0 text-primary" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search the knowledge… (eras, triggers, gradle, paper…)")}
          className="h-9 max-w-md text-xs"
        />
        {query.trim().length >= 2 && (
          <Badge variant="outline" className="text-[10px]">{results.length}</Badge>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {results.map((article) => {
          const open = expanded === article.id;
          return (
            <div key={article.id} className="rounded-xl border border-border/70 bg-card/60">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-3 text-left"
                onClick={() => setExpanded(open ? null : article.id)}
              >
                <BookMarked className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{article.title}</span>
                <Badge variant="outline" className="shrink-0 text-[9px]">
                  {CATEGORY_LABEL[article.category]}
                </Badge>
              </button>
              {open && (
                <div className="border-t border-border/60 px-4 py-3">
                  <p className="flex items-start gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-400">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {article.verified}
                  </p>
                  <div className="chat-md mt-3 text-sm leading-relaxed text-foreground/90">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{article.body}</ReactMarkdown>
                  </div>
                  <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    {t("Official sources")}:
                    {article.sources.map((source) => (
                      <a
                        key={source}
                        href={source}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-primary transition-colors hover:border-primary/40"
                      >
                        {new URL(source).hostname}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ))}
                  </p>
                </div>
              )}
            </div>
          );
        })}
        {results.length === 0 && (
          <p className={cn("rounded-xl border border-dashed border-border/70 px-6 py-12 text-center text-xs text-muted-foreground")}>
            {t("Nothing matches — try era, trigger, gradle, paper, launcher or fallback.")}
          </p>
        )}
      </div>
    </div>
  );
}
