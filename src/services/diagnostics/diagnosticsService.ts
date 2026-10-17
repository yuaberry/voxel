import { invoke } from "@tauri-apps/api/core";
import { getDb } from "@/services/db/client";

/**
 * Real self-diagnostics — every check EXECUTES. Rust probes storage, the
 * official download endpoints and Java; the database probe runs here
 * because SQLite belongs to the JS layer. A check never lies: if it didn't
 * run, it says so.
 */

export interface DiagnosticCheck {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
  /** What to do about it when failing — empty when ok. */
  fix: string;
}

interface RustCheck {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
  fix: string;
}

async function checkDatabase(): DiagnosticCheckPromise {
  try {
    const db = await getDb();
    await db.select("SELECT 1");
    return {
      id: "database",
      title: "Local database",
      ok: true,
      detail: "SQLite answered SELECT 1",
      fix: "",
    };
  } catch (error) {
    return {
      id: "database",
      title: "Local database",
      ok: false,
      detail: String(error),
      fix: "The app database (your projects/servers list) could not open. Restart the app — if it stays red, the db file may be locked by antivirus or another VOXEL window.",
    };
  }
}

type DiagnosticCheckPromise = Promise<DiagnosticCheck>;

export async function runDiagnostics(basePath: string): Promise<DiagnosticCheck[]> {
  const [rustChecks, dbCheck] = await Promise.all([
    invoke<RustCheck[]>("diagnostics_run", { basePath }),
    checkDatabase(),
  ]);
  // order: the things the user can fix first (db, storage, java, network)
  const order = ["database", "storage", "java", "mojang", "papermc", "modrinth"];
  const all = [...rustChecks, dbCheck];
  return all.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
