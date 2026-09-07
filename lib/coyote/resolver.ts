// Server-only. Resolves which COYOTE file is current and returns its raw text plus
// provenance — nothing else. Mirrors scripts/build_coyote_index.py:resolve_current()
// deliberately rather than reinventing resolution: newest-by-mtime, excluding patch
// files and undersized files, never a filename pattern match (three naming conventions
// are in circulation and a pattern match has gone stale on this workspace before).
//
// The local-filesystem implementation below is one `CoyoteSourceProvider`. Production
// delivery (Vercel has no access to this local, gitignored path) will be a different
// provider implementing the same interface — the parser never needs to know which one
// is in use.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATCH_MARKER = "PATCH";
const MIN_SIZE_BYTES = 100_000;

export interface CoyoteSource {
  text: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  /** ISO timestamp — the file's own mtime. */
  modifiedAt: string;
}

export interface ResolverDiagnostic {
  severity: "error";
  message: string;
}

export type ResolverResult =
  | { ok: true; source: CoyoteSource }
  | { ok: false; diagnostic: ResolverDiagnostic };

export interface CoyoteSourceProvider {
  resolve(): Promise<ResolverResult>;
}

/** apps/brain-map/src/lib/coyote -> apps/brain-map/src/lib -> src -> brain-map -> apps -> repo root. */
function defaultCoyoteDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../../../context/import/coyote");
}

interface Candidate {
  filePath: string;
  fileName: string;
  mtimeMs: number;
  size: number;
}

async function listCandidates(dir: string): Promise<Candidate[]> {
  const entries = await readdir(dir);
  const candidates: Candidate[] = [];
  for (const fileName of entries) {
    if (!fileName.toLowerCase().endsWith(".md")) continue;
    if (fileName.toUpperCase().includes(PATCH_MARKER)) continue;
    const filePath = path.join(dir, fileName);
    const info = await stat(filePath);
    if (!info.isFile()) continue;
    if (info.size <= MIN_SIZE_BYTES) continue;
    candidates.push({ filePath, fileName, mtimeMs: info.mtimeMs, size: info.size });
  }
  return candidates;
}

export function createLocalFileCoyoteProvider(dirOverride?: string): CoyoteSourceProvider {
  const dir = dirOverride ?? process.env.COYOTE_LOCAL_DIR ?? defaultCoyoteDir();

  return {
    async resolve(): Promise<ResolverResult> {
      let candidates: Candidate[];
      try {
        candidates = await listCandidates(dir);
      } catch (err) {
        return {
          ok: false,
          diagnostic: { severity: "error", message: `Could not read COYOTE directory "${dir}": ${(err as Error).message}` },
        };
      }

      if (candidates.length === 0) {
        return { ok: false, diagnostic: { severity: "error", message: `No COYOTE candidates found in "${dir}"` } };
      }

      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const chosen = candidates[0];

      let text: string;
      try {
        text = await readFile(chosen.filePath, "utf-8");
      } catch (err) {
        return {
          ok: false,
          diagnostic: { severity: "error", message: `Could not read COYOTE file "${chosen.filePath}": ${(err as Error).message}` },
        };
      }

      return {
        ok: true,
        source: {
          text,
          fileName: chosen.fileName,
          filePath: chosen.filePath,
          sizeBytes: chosen.size,
          modifiedAt: new Date(chosen.mtimeMs).toISOString(),
        },
      };
    },
  };
}

/** Convenience default — the local-file provider, resolved once. */
export function resolveCoyoteSource(): Promise<ResolverResult> {
  return createLocalFileCoyoteProvider().resolve();
}
