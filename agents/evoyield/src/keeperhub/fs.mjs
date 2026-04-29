// Atomic, crash-safe JSON store used by the KeeperHub workflow registry.
// Pattern: write to <path>.tmp-<rand>, fsync, then rename onto target.
// On Windows fs.rename of a file onto an existing path can fail with EPERM —
// we work around this by removing the destination first inside a retry loop.

import { promises as fs } from "node:fs";
import { dirname, basename, join } from "node:path";
import { randomBytes } from "node:crypto";

export async function readJson(path, fallback) {
  try {
    const raw = await fs.readFile(path, "utf8");
    if (!raw.trim()) return structuredClone(fallback);
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return structuredClone(fallback);
    if (err instanceof SyntaxError) {
      // Corrupt file — preserve it for forensics, return fallback
      const backup = `${path}.corrupt-${Date.now()}`;
      await fs.rename(path, backup).catch(() => {});
      return structuredClone(fallback);
    }
    throw err;
  }
}

export async function writeJsonAtomic(path, value) {
  const dir  = dirname(path);
  const name = basename(path);
  const tmp  = join(dir, `.${name}.tmp-${randomBytes(6).toString("hex")}`);

  await fs.mkdir(dir, { recursive: true });
  const data = JSON.stringify(value, null, 2) + "\n";
  let handle;
  try {
    handle = await fs.open(tmp, "w");
    await handle.writeFile(data, "utf8");
    await handle.sync().catch(() => {}); // best-effort fsync — ignored on filesystems that don't support it
  } finally {
    await handle?.close().catch(() => {});
  }

  // Atomic rename. On Windows the destination must not exist for rename to be
  // atomic, so try plain rename first, then fall back to remove+rename with
  // retries (handles antivirus/file-watcher races).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rename(tmp, path);
      return;
    } catch (err) {
      if (err.code === "EEXIST" || err.code === "EPERM" || err.code === "EBUSY") {
        await fs.unlink(path).catch(() => {});
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
        continue;
      }
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }
  await fs.unlink(tmp).catch(() => {});
  throw new Error(`writeJsonAtomic: failed to commit ${path} after retries`);
}

// Simple in-process mutex so concurrent calls into the same store serialize.
const _locks = new Map();
export async function withLock(key, fn) {
  const prev = _locks.get(key) ?? Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  _locks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (_locks.get(key) === prev.then(() => next)) _locks.delete(key);
  }
}
