import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PbiConfig } from "./team.js";
import { PBI_FILENAME_REGEX, parsePbiFilename } from "./pbi-filename.js";

function pbiDirAbsolute(cfg: PbiConfig): string {
  return join(cfg.vault, cfg.dir);
}

export function listPbiFiles(cfg: PbiConfig): Array<{ id: number; slug: string; filename: string }> {
  const dir = pbiDirAbsolute(cfg);
  if (!existsSync(dir)) {
    throw new Error(`PBI directory does not exist: ${dir}. Create it first or fix pbi.vault/dir.`);
  }
  const entries: Array<{ id: number; slug: string; filename: string }> = [];
  for (const name of readdirSync(dir)) {
    const parsed = parsePbiFilename(name);
    if (parsed) entries.push({ ...parsed, filename: name });
  }
  return entries;
}

export function nextPbiNumber(cfg: PbiConfig): number {
  const files = listPbiFiles(cfg);
  if (files.length === 0) return 1;
  return Math.max(...files.map((f) => f.id)) + 1;
}

export function resolvePbiPath(cfg: PbiConfig, id: number): string {
  const matches = listPbiFiles(cfg).filter((f) => f.id === id);
  const padded = String(id).padStart(3, "0");
  if (matches.length === 0) {
    throw new Error(`PBI-${padded} not found in ${pbiDirAbsolute(cfg)}`);
  }
  if (matches.length > 1) {
    throw new Error(`multiple PBI-${padded} files found: ${matches.map((m) => m.filename).join(", ")}`);
  }
  return join(pbiDirAbsolute(cfg), matches[0]!.filename);
}
