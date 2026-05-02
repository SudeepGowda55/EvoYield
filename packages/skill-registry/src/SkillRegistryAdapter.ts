/**
 * @evoframe/skill-registry — SkillRegistryAdapter
 *
 * TypeScript client for the SkillRegistry.sol contract deployed on 0G Chain.
 * Uses viem for type-safe contract interaction.
 */

import { createHash } from "node:crypto";
import { SkillGenome, ISkillRegistryAdapter, SkillDomain } from "@evoframe/core";
import type { PublicClient, WalletClient, Hash, Address } from "viem";

// ---------------------------------------------------------------------------
// ABI (minimal — only functions we need at runtime)
// ---------------------------------------------------------------------------

export const SKILL_REGISTRY_ABI = [
  {
    name: "registerSkill",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "skillId", type: "bytes32" },
      { name: "parentId", type: "bytes32" },
      { name: "storageHash", type: "string" },
      { name: "name", type: "string" },
      { name: "domain", type: "uint8" },
      { name: "generation", type: "uint32" },
      { name: "fitnessScore", type: "uint32" },
    ],
    outputs: [],
  },
  {
    name: "recordImport",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "skillId", type: "bytes32" },
      { name: "importingAgent", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "updateFitness",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "skillId", type: "bytes32" },
      { name: "newScore", type: "uint32" },
    ],
    outputs: [],
  },
  {
    name: "getTopSkills",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "domain", type: "uint8" },
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      { name: "result", type: "bytes32[]" },
      { name: "total", type: "uint256" },
    ],
  },
  {
    name: "skills",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "skillId", type: "bytes32" }],
    outputs: [
      { name: "skillId", type: "bytes32" },
      { name: "parentId", type: "bytes32" },
      { name: "originAgent", type: "address" },
      { name: "storageHash", type: "string" },
      { name: "name", type: "string" },
      { name: "domain", type: "uint8" },
      { name: "generation", type: "uint32" },
      { name: "fitnessScore", type: "uint32" },
      { name: "usageCount", type: "uint64" },
      { name: "createdAt", type: "uint64" },
      { name: "active", type: "bool" },
    ],
  },
  {
    name: "getLineage",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "skillId", type: "bytes32" }],
    outputs: [{ name: "chain", type: "bytes32[]" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Domain enum mapping
// ---------------------------------------------------------------------------

const DOMAIN_MAP: Record<string, number> = {
  research: 0,
  coding: 1,
  reasoning: 2,
  "data-analysis": 3,
  "web-browsing": 4,
  communication: 5,
  planning: 6,
  general: 7,
  // extended domains mapped to DOMAIN_GENERAL (contract only supports 0-7)
  defi: 7,
  trading: 7,
  finance: 7,
};

const DOMAIN_REVERSE: Record<number, SkillDomain> = Object.fromEntries(
  Object.entries(DOMAIN_MAP).map(([k, v]) => [v, k as SkillDomain]),
);

// ---------------------------------------------------------------------------
// SkillRegistryAdapter
// ---------------------------------------------------------------------------

export interface RegistryAdapterConfig {
  contractAddress: string;
  agentAddress: string;
  /** If not provided, operates in read-only mode */
  walletClient?: WalletClient;
  publicClient?: PublicClient;
  /** Fallback in-memory store when chain not available */
  localMode?: boolean;
}

export class SkillRegistryAdapter implements ISkillRegistryAdapter {
  private readonly config: RegistryAdapterConfig;
  // In-memory mirror for local/offline mode
  private readonly localStore = new Map<string, SkillGenome>();

  constructor(config: RegistryAdapterConfig) {
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // ISkillRegistryAdapter implementation
  // ---------------------------------------------------------------------------

  async register(genome: SkillGenome): Promise<string> {
    // Local mode fallback
    if (this.config.localMode || !this.config.walletClient) {
      this.localStore.set(genome.id, genome);
      return `local-tx-${genome.id}`;
    }

    const skillId32 = this.uuidToBytes32(genome.id);
    const parentId32 = genome.parentId
      ? this.uuidToBytes32(genome.parentId)
      : (("0x" + "00".repeat(32)) as `0x${string}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash = await (this.config.walletClient.writeContract as any)({
      address: this.config.contractAddress as Address,
      abi: SKILL_REGISTRY_ABI,
      functionName: "registerSkill",
      args: [
        skillId32,
        parentId32,
        genome.storageKey,
        genome.name,
        DOMAIN_MAP[genome.domain],
        genome.generation,
        genome.fitnessScore,
      ],
    });

    return hash as string;
  }

  async getTopSkills(domain: SkillDomain, limit: number): Promise<SkillGenome[]> {
    // Local mode
    if (this.config.localMode || !this.config.publicClient) {
      return Array.from(this.localStore.values())
        .filter((s) => s.domain === domain && s.status === "active")
        .sort((a, b) => b.fitnessScore - a.fitnessScore)
        .slice(0, limit);
    }

    const domainId = DOMAIN_MAP[domain] ?? DOMAIN_MAP["general"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [skillIds] = (await (this.config.publicClient.readContract as any)({
      address: this.config.contractAddress as Address,
      abi: SKILL_REGISTRY_ABI,
      functionName: "getTopSkills",
      args: [domainId, BigInt(0), BigInt(limit)],
    })) as [readonly `0x${string}`[], bigint];

    // For each skill ID, fetch full entry
    const genomes: SkillGenome[] = [];
    for (const id of skillIds) {
      const entry = await this.fetchSkillEntry(id);
      if (entry) genomes.push(entry);
    }

    return genomes;
  }

  async recordUsage(skillId: string, agentAddress: string): Promise<void> {
    if (this.config.localMode || !this.config.walletClient) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.config.walletClient.writeContract as any)({
      address: this.config.contractAddress as Address,
      abi: SKILL_REGISTRY_ABI,
      functionName: "recordImport",
      args: [this.uuidToBytes32(skillId), agentAddress as Address],
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async fetchSkillEntry(skillId32: `0x${string}`): Promise<SkillGenome | null> {
    if (!this.config.publicClient) return null;

    const entry = (await this.config.publicClient.readContract({
      address: this.config.contractAddress as Address,
      abi: SKILL_REGISTRY_ABI,
      functionName: "skills",
      args: [skillId32],
    })) as [
      `0x${string}`, // skillId
      `0x${string}`, // parentId
      Address, // originAgent
      string, // storageHash
      string, // name
      number, // domain
      number, // generation
      number, // fitnessScore
      bigint, // usageCount
      bigint, // createdAt
      boolean, // active
    ];

    if (!entry[10]) return null; // not active

    const id = this.bytes32ToUuid(entry[0]);
    const parentId = entry[1] === "0x" + "00".repeat(32) ? null : this.bytes32ToUuid(entry[1]);

    return {
      id,
      name: entry[4],
      description: `Imported skill: ${entry[4]}`,
      domain: DOMAIN_REVERSE[entry[5]] ?? "general",
      version: `${entry[6]}.0.0`,
      implementation: "", // fetched from 0G Storage separately
      parameters: [],
      outputDescription: "",
      parentId,
      generation: entry[6],
      originAgent: entry[2],
      parentStorageHash: null,
      fitnessScore: entry[7],
      usageCount: Number(entry[8]),
      failureCount: 0,
      benchmarkResults: [],
      status: "active",
      createdAt: Number(entry[9]) * 1000,
      updatedAt: Number(entry[9]) * 1000,
      storageKey: entry[3],
      sealedInferenceAttestation: null,
      onChainTxHash: skillId32,
    };
  }

  /** Convert UUID string to bytes32 hex (keccak256 of the UUID bytes) */
  private uuidToBytes32(uuid: string): `0x${string}` {
    const hash = createHash("sha256").update(uuid).digest("hex");
    return `0x${hash}` as `0x${string}`;
  }

  private bytes32ToUuid(bytes32: `0x${string}`): string {
    // Reverse mapping not strictly possible without a lookup table;
    // for hackathon we use the hex as-is as the ID
    return bytes32.slice(2);
  }
}
