/**
 * Briefing documents — the owner's ask: bring your own .txt/.md/.pdf/.docx
 * (the formats Google Drive ships) into a project or a server. The Rust
 * side extracts the real text (docx unzipped, pdf parsed, txt/md as-is) and
 * the briefings land where the agent reads them.
 */
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface ImportedBriefing {
  fileName: string;
  kind: string;
  targetPath: string;
}

export async function importBriefingDocuments(
  basePath: string,
  relDir: string,
): Promise<ImportedBriefing[]> {
  const picked = await open({
    multiple: true,
    title: "Import briefing documents (.txt, .md, .pdf, .docx)",
    filters: [
      {
        name: "Documents (Google Drive formats)",
        extensions: ["txt", "md", "pdf", "docx"],
      },
    ],
  });
  if (!picked) return [];
  const paths = Array.isArray(picked) ? picked : [picked];

  const imported: ImportedBriefing[] = [];
  for (const filePath of paths) {
    const doc = await invoke<{ fileName: string; kind: string; text: string }>(
      "documents_extract",
      { filePath },
    );
    const targetPath = await invoke<string>("documents_write", {
      basePath,
      relDir,
      fileName: doc.fileName,
      kind: doc.kind,
      text: doc.text,
    });
    imported.push({ fileName: doc.fileName, kind: doc.kind, targetPath });
  }
  return imported;
}

export async function listBriefingDocuments(
  basePath: string,
  relDir: string,
): Promise<{ name: string; sizeBytes: number }[]> {
  try {
    const entries = await invoke<
      { path: string; isDir: boolean; sizeBytes: number }[]
    >("list_project_files", { basePath, projectRel: relDir });
    return entries
      .filter((e) => !e.isDir && e.path.endsWith(".brief.md"))
      .map((e) => ({
        name: e.path.split("/").pop() ?? e.path,
        sizeBytes: e.sizeBytes,
      }));
  } catch {
    return []; // no folder yet — an honest empty list
  }
}

/** Picks files and extracts their text NOW (dialog + Rust extraction) —
 * the texts are held in memory so wizards can persist them right after
 * the project/server folder exists. */
export async function pickBriefingDocuments(): Promise<
  { fileName: string; kind: string; text: string }[]
> {
  const picked = await open({
    multiple: true,
    title: "Import briefing documents (.txt, .md, .pdf, .docx)",
    filters: [
      {
        name: "Documents (Google Drive formats)",
        extensions: ["txt", "md", "pdf", "docx"],
      },
    ],
  });
  if (!picked) return [];
  const paths = Array.isArray(picked) ? picked : [picked];
  const docs: { fileName: string; kind: string; text: string }[] = [];
  for (const filePath of paths) {
    const doc = await invoke<{ fileName: string; kind: string; text: string }>(
      "documents_extract",
      { filePath },
    );
    docs.push({ fileName: doc.fileName, kind: doc.kind, text: doc.text });
  }
  return docs;
}

/** Persists picked documents once the target folder exists. */
export async function writeBriefingDocuments(
  basePath: string,
  relDir: string,
  docs: { fileName: string; kind: string; text: string }[],
): Promise<string[]> {
  const written: string[] = [];
  for (const doc of docs) {
    const targetPath = await invoke<string>("documents_write", {
      basePath,
      relDir,
      fileName: doc.fileName,
      kind: doc.kind,
      text: doc.text,
    });
    written.push(targetPath);
  }
  return written;
}
