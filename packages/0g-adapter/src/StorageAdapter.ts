/**
 * @evoframe/0g-adapter — StorageAdapter
 *
 * Implements IStorageAdapter against 0G Storage:
 *  - KV store  → genome read/write (0G Storage blobs via Indexer)
 *  - Log store → append-only lineage history (0G Storage blobs)
 *
 * 0G Storage TypeScript SDK: @0gfoundation/0g-storage-ts-sdk
 *   https://build.0g.ai/storage/
 *
 * Operational modes:
 *   "live"  — real 0G Storage node (requires storageRpcUrl + chainRpcUrl + privateKey)
 *   "local" — JSON file cache for offline development / CI
 *
 * The adapter always maintains a local JSON cache which:
 *   a) provides instant reads without round-trips to the network
 *   b) stores the storageKey → 0G rootHash mapping for fast retrieval
 *   c) acts as a fallback when the 0G node is temporarily unreachable
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { SkillGenome } from "@evoframe/core";
import type { IStorageAdapter, LineageEntry } from "@evoframe/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySdk = any;

// ---------------------------------------------------------------------------
// StorageAdapter config
// ---------------------------------------------------------------------------

export interface StorageAdapterConfig {
  /** 0G Storage indexer RPC URL — e.g. https://indexer-storage-testnet-turbo.0g.ai */
  storageRpcUrl?: string;
  /** 0G / EVM chain RPC — needed so the SDK can submit on-chain transactions */
  chainRpcUrl?: string;
  /** Agent private key (0x…) — used to sign storage transactions */
  privateKey?: string;
  /** Force local-only mode even when live config is present */
  localMode?: boolean;
  /** Path to JSON persistence file. Defaults to .evoframe-cache.json in cwd */
  localCachePath?: string;
}

interface LocalCache {
  kv: Record<string, string>;
  log: LineageEntry[];
  /** storageKey → 0G rootHash so we can re-fetch blobs without the on-chain index */
  hashIndex: Record<string, string>;
}

// ---------------------------------------------------------------------------
// StorageAdapter
// ---------------------------------------------------------------------------

export class StorageAdapter implements IStorageAdapter {
  private readonly config: StorageAdapterConfig;
  private readonly localKv = new Map<string, string>();
  private readonly localLog: LineageEntry[] = [];
  /** storageKey → 0G rootHash for live retrieval */
  private readonly hashIndex = new Map<string, string>();

  private zgSdk: AnySdk = null;
  private zgSigner: AnySdk = null;
  private liveReady = false;
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
      for (const [k, v] of Object.entries(cache.hashIndex ?? {})) this.hashIndex.set(k, v);
    } catch {
      // corrupt cache — start fresh
    }
  }

  private saveLocalCache(): void {
    try {
      const cache: LocalCache = {
        kv: Object.fromEntries(this.localKv),
        log: this.localLog,
        hashIndex: Object.fromEntries(this.hashIndex),
      };
      writeFileSync(this.cachePath, JSON.stringify(cache, null, 2), "utf8");
    } catch {
      // best-effort
    }
  }

  // ---------------------------------------------------------------------------
  // Initialisation — loads SDK and creates signer once
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialized) return;

    // Always load the local cache (used as fast-path even in live mode)
    this.loadLocalCache();

    const { storageRpcUrl, chainRpcUrl, privateKey, localMode } = this.config;
    if (!localMode && storageRpcUrl && chainRpcUrl && privateKey) {
      try {
        this.zgSdk = await import("@0gfoundation/0g-storage-ts-sdk");
        const { Wallet, JsonRpcProvider } = await import("ethers");
        const provider = new JsonRpcProvider(chainRpcUrl);
        this.zgSigner = new Wallet(privateKey, provider);
        this.liveReady = true;
        console.log("  📦 0G Storage: live mode active");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠️  0G Storage: live mode unavailable (${msg}) — using local fallback`);
      }
    }

    this.initialized = true;
  }

  /** Returns true when uploads are going to real 0G Storage */
  isLive(): boolean {
    return this.liveReady;
  }

  // ---------------------------------------------------------------------------
  // IStorageAdapter — storeGenome
  // ---------------------------------------------------------------------------

  async storeGenome(genome: SkillGenome): Promise<string> {
    await this.init();
    const serialized = JSON.stringify(genome, null, 2);

    // Always update local cache first (instant reads + fallback)
    this.localKv.set(genome.storageKey, serialized);

    if (this.liveReady) {
      try {
        const rootHash = await this.zgUpload(serialized);
        this.hashIndex.set(genome.storageKey, rootHash);
        this.saveLocalCache();
        console.log(`  📦 0G Storage ↑ ${genome.storageKey} → ${rootHash.slice(0, 20)}…`);
        return rootHash;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠️  0G Storage upload failed (${msg}) — stored locally only`);
      }
    }

    this.saveLocalCache();
    return this.contentHash(serialized);
  }

  // ---------------------------------------------------------------------------
  // IStorageAdapter — fetchGenome
  // ---------------------------------------------------------------------------

  async fetchGenome(storageKey: string): Promise<SkillGenome | null> {
    await this.init();

    // Try live 0G Storage if we have the rootHash for this key
    if (this.liveReady) {
      const rootHash = this.hashIndex.get(storageKey);
      if (rootHash) {
        try {
          const json = await this.zgDownload(rootHash);
          // Refresh local cache with the authoritative 0G copy
          this.localKv.set(storageKey, json);
          this.saveLocalCache();
          return JSON.parse(json) as SkillGenome;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  ⚠️  0G Storage fetch failed, using local cache: ${msg}`);
        }
      }
    }

    const raw = this.localKv.get(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as SkillGenome;
  }

  // ---------------------------------------------------------------------------
  // IStorageAdapter — appendLineageEntry
  // ---------------------------------------------------------------------------

  async appendLineageEntry(entry: LineageEntry): Promise<void> {
    await this.init();
    const serialized = JSON.stringify(entry);
    const logKey = `lineage:${entry.skillId}:${entry.timestamp}`;

    if (this.liveReady) {
      try {
        const rootHash = await this.zgUpload(serialized);
        this.hashIndex.set(logKey, rootHash);
        console.log(
          `  📋 0G Storage lineage ↑ gen-${entry.generation} fitness=${entry.fitnessScore} → ${rootHash.slice(0, 20)}…`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠️  0G Storage lineage upload failed: ${msg}`);
      }
    }

    this.localLog.push(entry);
    this.saveLocalCache();
  }

  // ---------------------------------------------------------------------------
  // IStorageAdapter — listActiveSkillKeys
  // ---------------------------------------------------------------------------

  async listActiveSkillKeys(domain?: string): Promise<string[]> {
    await this.init();
    const keys: string[] = [];
    for (const [key, raw] of this.localKv.entries()) {
      if (!key.startsWith("skill:")) continue;
      try {
        const genome = JSON.parse(raw) as SkillGenome;
        if (genome.status !== "active") continue;
        if (domain && genome.domain !== domain) continue;
        keys.push(key);
      } catch {
        // skip malformed entries
      }
    }
    return keys;
  }

  // ---------------------------------------------------------------------------
  // Inspection helpers (CLI + demo)
  // ---------------------------------------------------------------------------

  async getAllGenomes(): Promise<SkillGenome[]> {
    const genomes: SkillGenome[] = [];
    for (const raw of this.localKv.values()) {
      try {
        genomes.push(JSON.parse(raw) as SkillGenome);
      } catch {
        // skip malformed
      }
    }
    return genomes;
  }

  getLineageLog(): LineageEntry[] {
    return [...this.localLog];
  }

  /** Returns the 0G rootHash for a given storageKey, or null if not yet uploaded */
  getRootHash(storageKey: string): string | null {
    return this.hashIndex.get(storageKey) ?? null;
  }

  // ---------------------------------------------------------------------------
  // 0G Storage SDK helpers
  // ---------------------------------------------------------------------------

  /**
   * Upload JSON content to 0G Storage via MemData + Indexer.
   * Returns the merkle rootHash that identifies the blob.
   */
  private async zgUpload(content: string): Promise<string> {
    const { MemData, Indexer } = this.zgSdk;
    const buf = Buffer.from(content, "utf8");
    const data = new MemData(buf);

    const indexer = new Indexer(this.config.storageRpcUrl!);
    const [result, err] = await indexer.upload(data, this.config.chainRpcUrl!, this.zgSigner, {
      tags: "0x",
      finalityRequired: true,
    });

    if (err) throw new Error(`0G upload error: ${String(err)}`);

    return this.extractRootHash(result, content);
  }

  /**
   * Download a blob from 0G Storage by its rootHash.
   * The SDK downloads to a temp file; we read and delete it.
   */
  private async zgDownload(rootHash: string): Promise<string> {
    const { Indexer } = this.zgSdk;
    const tmpPath = resolve(tmpdir(), `evo-${randomUUID()}.json`);

    const indexer = new Indexer(this.config.storageRpcUrl!);
    const err = await indexer.download(rootHash, tmpPath, false);
    if (err) throw new Error(`0G download error: ${String(err)}`);

    const content = readFileSync(tmpPath, "utf8");
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    return content;
  }

  private contentHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  private extractRootHash(result: unknown, content: string): string {
    if (result && typeof result === "object" && "rootHash" in result) {
      const rootHash = (result as { rootHash?: unknown }).rootHash;
      if (typeof rootHash === "string" && rootHash.length > 0) return rootHash;
    }

    if (result && typeof result === "object" && "rootHashes" in result) {
      const rootHashes = (result as { rootHashes?: unknown }).rootHashes;
      if (Array.isArray(rootHashes) && typeof rootHashes[0] === "string") return rootHashes[0];
    }

    return this.contentHash(content);
  }
}
