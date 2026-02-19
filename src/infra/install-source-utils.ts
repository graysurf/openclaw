import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommandWithTimeout } from "../process/exec.js";
import { resolveUserPath } from "../utils.js";
import { fileExists, resolveArchiveKind } from "./archive.js";

export async function withTempDir<T>(
  prefix: string,
  fn: (tmpDir: string) => Promise<T>,
): Promise<T> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function resolveArchiveSourcePath(archivePath: string): Promise<
  | {
      ok: true;
      path: string;
    }
  | {
      ok: false;
      error: string;
    }
> {
  const resolved = resolveUserPath(archivePath);
  if (!(await fileExists(resolved))) {
    return { ok: false, error: `archive not found: ${resolved}` };
  }

  if (!resolveArchiveKind(resolved)) {
    return { ok: false, error: `unsupported archive: ${resolved}` };
  }

  return { ok: true, path: resolved };
}

export async function packNpmSpecToArchive(params: {
  spec: string;
  timeoutMs: number;
  cwd: string;
}): Promise<
  | {
      ok: true;
      archivePath: string;
    }
  | {
      ok: false;
      error: string;
    }
> {
  const res = await runCommandWithTimeout(["npm", "pack", params.spec, "--ignore-scripts"], {
    timeoutMs: Math.max(params.timeoutMs, 300_000),
    cwd: params.cwd,
    env: {
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      NPM_CONFIG_IGNORE_SCRIPTS: "true",
    },
  });
  if (res.code !== 0) {
    return { ok: false, error: `npm pack failed: ${res.stderr.trim() || res.stdout.trim()}` };
  }

  const packed = (res.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .toReversed()
    .find((line) => line.endsWith(".tgz"));

  if (packed) {
    const packedPath = path.isAbsolute(packed) ? packed : path.join(params.cwd, packed);
    if (await fileExists(packedPath)) {
      return { ok: true, archivePath: packedPath };
    }
  }

  const archives = (await fs.readdir(params.cwd, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tgz"))
    .map((entry) => path.join(params.cwd, entry.name));

  if (archives.length === 0) {
    return { ok: false, error: "npm pack produced no archive" };
  }

  if (archives.length === 1) {
    return { ok: true, archivePath: archives[0] };
  }

  const mtimeByArchive = await Promise.all(
    archives.map(async (archivePath) => {
      const stat = await fs.stat(archivePath);
      return { archivePath, mtimeMs: stat.mtimeMs };
    }),
  );
  mtimeByArchive.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { ok: true, archivePath: mtimeByArchive[0].archivePath };
}
