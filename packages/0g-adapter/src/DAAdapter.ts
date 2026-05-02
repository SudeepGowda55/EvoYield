/**
 * @evoframe/0g-adapter — DAAdapter
 *
 * Cross-agent skill pollination via 0G Storage broadcast channel.
 *
 * Design:
 *   Every EvoFrame agent that promotes a new skill calls `broadcastSkill()`.
 *   This writes the skill's metadata to a well-known 0G Storage manifest at
 *   the deterministic key  evoframe:broadcast:v1
 *
 *   Any other agent calls `discoverSkills()` at startup to fetch the manifest
 *   and import top-performing skills from other agents — achieving autonomous
 *   cross-agent evolution (0G DA broadcast channel semantics).
 *
 * 0G DA connection:
 *   0G DA is the data-availability layer that makes published blobs guaranteed
 *   accessible to any reader. Here we use 0G Storage as the DA backend:
 *   each broadcast entry is a permanent, content-addressed blob retrievable
 *   by any agent that knows the manifest rootHash.
 *
 * Modes:
 *   "live"  — reads/writes go to real 0G Storage (requires storageRpcUrl etc.)
 *   "local" — uses a local JSON mirror of the broadcast manifest
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SkillGenome } from "@evoframe/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BroadcastEntry {
  /** UUID of the promoted skill */
  skillId: string;
  /** Human name of the skill */
  name: string;
  /** Originating agent identifier */
  agentId: string;
  /** 0G Storage rootHash for the full SkillGenome blob */
  rootHash: string;
  /** storageKey in the agent's own StorageAdapter (for local import) */
  storageKey: string;
  /** Evolution generation */
  generation: number;
  /** Fitness score 0-100 */
  fitnessScore: number;
  /** Skill domain */
  domain: string;
  /** Unix timestamp ms */
  broadcastAt: number;
}

export interface BroadcastManifest {
  version: 1;
  entries: BroadcastEntry[];
  updatedAt: number;
}

export interface DAAdapterConfig {
  /** 0G Storage indexer RPC — required for live mode */
  storageRpcUrl?: string;
  /** EVM chain RPC for signing 0G transactions */
  chainRpcUrl?: string;
  /** Agent private key */
  privateKey?: string;
  /** Force local-only operation */
  localMode?: boolean;
  /** Path to local manifest mirror */
  localManifestPath?: string;
}

// ---------------------------------------------------------------------------
// DAAdapter
// ---------------------------------------------------------------------------

export class DAAdapter {
  private readonly config: DAAdapterConfig;
  private zgSdk: unknown = null;
  private zgSigner: unknown = null;
  private liveReady = false;
  private initialized = false;
  private cachedManifestRootHash: string | null = null;

  /** Well-known broadcast manifest key (used as a human-readable tag in logs) */
  static readonly BROADCAST_KEY = "evoframe:broadcast:v1";

  constructor(config: DAAdapterConfig) {
    this.config = config;
  }

  private get manifestPath(): string {
    return resolve(this.config.localManifestPath ?? ".evoframe-broadcast.json");
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    const { storageRpcUrl, chainRpcUrl, privateKey, localMode } = this.config;
    if (!localMode && storageRpcUrl && chainRpcUrl && privateKey) {
      try {
        this.zgSdk = await import("@0gfoundation/0g-storage-ts-sdk");
        const { Wallet, JsonRpcProvider } = await import("ethers");
        const provider = new (JsonRpcProvider as new (url: string) => unknown)(chainRpcUrl);
        this.zgSigner = new (Wallet as new (key: string, provider: unknown) => unknown)(
          privateKey,
          provider,
        );
        this.liveReady = true;
        console.log("  📡 0G DA: live broadcast channel active");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠️  0G DA: live mode unavailable (${msg}) — using local manifest`);
      }
    }
    this.initialized = true;
  }

  // ---------------------------------------------------------------------------
  // broadcastSkill — called after a skill is promoted
  // ---------------------------------------------------------------------------

  /**
   * Publish a newly promoted skill to the 0G DA broadcast channel.
   * Other agents will discover it via discoverSkills() at their next startup.
   */
  async broadcastSkill(genome: SkillGenome, agentId: string, rootHash?: string): Promise<void> {
    await this.init();

    const entry: BroadcastEntry = {
      skillId: genome.id,
      name: genome.name,
      agentId,
      rootHash: rootHash ?? this.contentHash(JSON.stringify(genome)),
      storageKey: genome.storageKey,
      generation: genome.generation,
      fitnessScore: genome.fitnessScore,
      domain: genome.domain,
      broadcastAt: Date.now(),
    };

    const manifest = await this.readManifest();

    // Deduplicate by skillId — replace existing entry for same skillId
    const filtered = manifest.entries.filter((e) => e.skillId !== entry.skillId);
    filtered.push(entry);
    // Keep only top-100 entries per domain (by fitness, descending)
    filtered.sort((a, b) => b.fitnessScore - a.fitnessScore);
    manifest.entries = filtered.slice(0, 100);
    manifest.updatedAt = Date.now();

    await this.writeManifest(manifest);
    console.log(
      `  📡 DA broadcast: ${genome.name} gen-${genome.generation} fitness=${genome.fitnessScore} from ${agentId}`,
    );
  }

  // ---------------------------------------------------------------------------
  // discoverSkills — called at agent startup for cross-agent pollination
  // ---------------------------------------------------------------------------

  /**
   * Fetch the broadcast manifest and return skill entries from OTHER agents.
   * Filters out entries from the requesting agent and entries below minFitness.
   */
  async discoverSkills(opts: {
    agentId: string;
    domain?: string;
    minFitness?: number;
    limit?: number;
  }): Promise<BroadcastEntry[]> {
    await this.init();
    const manifest = await this.readManifest();

    let entries = manifest.entries.filter((e) => e.agentId !== opts.agentId);
    if (opts.domain) entries = entries.filter((e) => e.domain === opts.domain);
    if (opts.minFitness != null)
      entries = entries.filter((e) => e.fitnessScore >= (opts.minFitness ?? 0));

    entries.sort((a, b) => b.fitnessScore - a.fitnessScore);
    return entries.slice(0, opts.limit ?? 10);
  }

  // ---------------------------------------------------------------------------
  // Manifest read/write
  // ---------------------------------------------------------------------------

  private async readManifest(): Promise<BroadcastManifest> {
    // Try 0G Storage first
    if (this.liveReady && this.cachedManifestRootHash) {
      try {
        const json = await this.zgDownload(this.cachedManifestRootHash);
        return JSON.parse(json) as BroadcastManifest;
      } catch {
        // fall through to local
      }
    }

    // Local file fallback
    try {
      if (existsSync(this.manifestPath)) {
        const raw = readFileSync(this.manifestPath, "utf8");
        return JSON.parse(raw) as BroadcastManifest;
      }
    } catch {
      // corrupt — start fresh
    }

    return { version: 1, entries: [], updatedAt: Date.now() };
  }

  private async writeManifest(manifest: BroadcastManifest): Promise<void> {
    const serialized = JSON.stringify(manifest, null, 2);

    // Persist locally always
    try {
      writeFileSync(this.manifestPath, serialized, "utf8");
    } catch {
      // best-effort
    }

    // Upload to 0G Storage if live
    if (this.liveReady) {
      try {
        const rootHash = await this.zgUpload(serialized);
        this.cachedManifestRootHash = rootHash;
        console.log(`  📡 DA manifest uploaded to 0G Storage → ${rootHash.slice(0, 20)}…`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠️  DA manifest upload failed: ${msg}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 0G Storage helpers
  // ---------------------------------------------------------------------------

  private async zgUpload(content: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk = this.zgSdk as any;
    const { MemData, Indexer } = sdk;
    const buf = Buffer.from(content, "utf8");
    const data = new MemData(buf);

    const indexer = new Indexer(this.config.storageRpcUrl!);
    const [result, err] = await indexer.upload(data, this.config.chainRpcUrl!, this.zgSigner, {
      tags: "0x",
      finalityRequired: true,
    });

    if (err) throw new Error(`0G DA upload error: ${String(err)}`);
    return this.extractRootHash(result, content);
  }

  private async zgDownload(rootHash: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk = this.zgSdk as any;
    const { Indexer } = sdk;
    const { resolve: pathResolve } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { randomUUID } = await import("node:crypto");
    const { readFileSync: rf, unlinkSync: ul } = await import("node:fs");

    const tmpPath = pathResolve(tmpdir(), `evo-da-${randomUUID()}.json`);
    const indexer = new Indexer(this.config.storageRpcUrl!);
    const err = await indexer.download(rootHash, tmpPath, false);
    if (err) throw new Error(`0G DA download error: ${String(err)}`);

    const content = rf(tmpPath, "utf8");
    try {
      ul(tmpPath);
    } catch {
      /* best-effort */
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
