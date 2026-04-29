/**
 * @evoframe/0g-adapter — StorageAdapter
 *
 * Implements IStorageAdapter against 0G Storage:
 *  - KV store  → genome read/write (0G Storage key-value)
 *  - Log store → append-only lineage history (0G Storage log)
 *
 * 0G Storage TypeScript SDK reference:
 *   https://docs.0g.ai/developer-hub/building-on-0g/storage-sdk/typescript
 *
 * In hackathon mode we support two operational modes:
 *   1. "live"  — real 0G Storage node (requires STORAGE_RPC_URL env)
 *   2. "local" — in-memory fallback for offline development / CI
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SkillGenome } from "@evoframe/core";
import type { IStorageAdapter, LineageEntry } from "@evoframe/core";

// ---------------------------------------------------------------------------
// 0G Storage SDK shim
// We import the SDK lazily so the package compiles without the SDK installed.
// Developers must install @0glabs/0g-ts-sdk separately for live mode.
// ---------------------------------------------------------------------------

type ZgFile = {
  merkleRoot(): Promise<string>;
};

type Indexer = {
  upload(file: ZgFile): Promise<[string | null, unknown]>;
  download(rootHash: string, outputPath: string, withProof: boolean): Promise<void>;
};

async function loadSdk(): Promise<{
  ZgFile: new (content: Buffer, chunkSize: number) => ZgFile;
  Indexer: new (url: string, ethSigner: unknown) => Indexer;
} | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk = await import("@0glabs/0g-ts-sdk" as any);
    return sdk;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// StorageAdapter
// ---------------------------------------------------------------------------

export interface StorageAdapterConfig {
  storageRpcUrl: string;
  /** Optional ethers signer — needed for live uploads */
  ethSigner?: unknown;
  /** Force local mode even if SDK available */
  localMode?: boolean;
  /** Path to JSON file for local persistence. Defaults to .evoframe-cache.json in cwd */
  localCachePath?: string;
}

interface LocalCache {
  kv: Record<string, string>;
  log: LineageEntry[];
}

export class StorageAdapter implements IStorageAdapter {
  private readonly config: StorageAdapterConfig;
  // In-memory fallback store (key → serialized genome)
  private readonly localKv = new Map<string, string>();
  private readonly localLog: LineageEntry[] = [];
  private sdk: Awaited<ReturnType<typeof loadSdk>> | null = null;
  private initialized = false;

  constructor(config: StorageAdapterConfig) {
    this.config = config;
  }

  private get cachePath(): string {
    return resolve(this.config.localCachePath ?? ".evoframe-cache.json");
  }

  private loadLocalCache(): void {
    try {
      if (!existsSync(this.cachePath)) return;
      const raw = readFileSync(this.cachePath, "utf8");
      const cache = JSON.parse(raw) as LocalCache;
      for (const [k, v] of Object.entries(cache.kv ?? {})) this.localKv.set(k, v);
      for (const entry of cache.log ?? []) this.localLog.push(entry);
    } catch {
      // corrupt cache — ignore, start fresh
    }
  }

  private saveLocalCache(): void {
    try {
      const cache: LocalCache = {
        kv: Object.fromEntries(this.localKv),
        log: this.localLog,
      };
      writeFileSync(this.cachePath, JSON.stringify(cache, null, 2), "utf8");
    } catch {
      // best-effort
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.config.localMode) {
      this.sdk = await loadSdk();
    } else {
      // Load previously persisted skills from disk
      this.loadLocalCache();
    }
    this.initialized = true;
  }

  // ---------------------------------------------------------------------------
  // IStorageAdapter implementation
  // ---------------------------------------------------------------------------

  async storeGenome(genome: SkillGenome): Promise<string> {
    await this.init();
    const serialized = JSON.stringify(genome, null, 2);
    const hash = this.contentHash(serialized);

    if (this.sdk && this.config.ethSigner) {
      // Live mode: upload to 0G Storage
      return await this.upload0GStorage(genome.storageKey, serialized);
    }

    // Local mode fallback — persist to disk so skills survive restarts
    this.localKv.set(genome.storageKey, serialized);
    this.saveLocalCache();
    return hash;
  }

  async fetchGenome(storageKey: string): Promise<SkillGenome | null> {
    await this.init();

    if (this.sdk && this.config.ethSigner) {
      return await this.download0GStorage(storageKey);
    }

    const raw = this.localKv.get(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as SkillGenome;
  }

  async appendLineageEntry(entry: LineageEntry): Promise<void> {
    await this.init();
    const serialized = JSON.stringify(entry);

    if (this.sdk && this.config.ethSigner) {
      // Log entries use a deterministic key: lineage:<skillId>:<timestamp>
      const logKey = `lineage:${entry.skillId}:${entry.timestamp}`;
      await this.upload0GStorage(logKey, serialized);
      return;
    }

    // Local fallback — persist to disk
    this.localLog.push(entry);
    this.saveLocalCache();
  }

  async listActiveSkillKeys(domain?: string): Promise<string[]> {
    await this.init();

    if (this.sdk) {
      // In a production 0G deployment you would query an indexer contract.
      // For hackathon we list from local registry mirror.
    }

    const keys: string[] = [];
    for (const [key, raw] of this.localKv.entries()) {
      if (!key.startsWith("skill:")) continue;
      const genome = JSON.parse(raw) as SkillGenome;
      if (genome.status !== "active") continue;
      if (domain && genome.domain !== domain) continue;
      keys.push(key);
    }
    return keys;
  }

  // ---------------------------------------------------------------------------
  // Inspection helpers (for CLI + demo)
  // ---------------------------------------------------------------------------

  async getAllGenomes(): Promise<SkillGenome[]> {
    const genomes: SkillGenome[] = [];
    for (const raw of this.localKv.values()) {
      try {
        genomes.push(JSON.parse(raw) as SkillGenome);
      } catch {
        // skip malformed entries
      }
    }
    return genomes;
  }

  getLineageLog(): LineageEntry[] {
    return [...this.localLog];
  }

  // ---------------------------------------------------------------------------
  // 0G Storage SDK helpers
  // ---------------------------------------------------------------------------

  private async upload0GStorage(key: string, content: string): Promise<string> {
    if (!this.sdk) throw new Error("0G SDK not available");

    const buf = Buffer.from(content, "utf8");
    // 0G Storage works with file-like objects; we use a 256KB chunk size
    const file = new this.sdk.ZgFile(buf, 256 * 1024);
    const rootHash = await file.merkleRoot();

    const indexer = new this.sdk.Indexer(this.config.storageRpcUrl, this.config.ethSigner);

    const [error] = await indexer.upload(file);
    if (error) throw new Error(`0G Storage upload failed: ${String(error)}`);

    return rootHash;
  }

  private async download0GStorage(key: string): Promise<SkillGenome | null> {
    // In a real 0G integration you would resolve the root hash from an
    // on-chain registry (SkillRegistry.sol maps key → rootHash).
    // For the hackathon demo we fall through to local KV.
    const raw = this.localKv.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as SkillGenome;
  }

  private contentHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }
}
