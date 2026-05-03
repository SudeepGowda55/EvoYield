// Singleton agent instance shared across server routes and KeeperHub cycle.
// Entry points (agent.mjs / server.mjs / keeperhub.mjs) load dotenv before
// importing this module, so process.env.* is available inside functions.
//
// Live integrations enabled when env vars are set:
//   ZG_PRIVATE_KEY + ZG_STORAGE_RPC           → real 0G Storage uploads
//   ZG_PRIVATE_KEY + SKILL_REGISTRY_ADDRESS   → on-chain skill registration
//   ZG_PRIVATE_KEY + ZG_STORAGE_RPC           → 0G DA cross-agent broadcast

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { EvoYieldAgent } from "./EvoYieldAgent.mjs";
import { StorageAdapter, ComputeAdapter, DAAdapter } from "@evoframe/0g-adapter";
import { SkillRegistryAdapter } from "@evoframe/skill-registry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../");

// 0G Galileo testnet chain definition
const ZG_CHAIN = {
  id: 16602,
  name: "0G Galileo",
  nativeCurrency: { name: "A0GI", symbol: "A0GI", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
};

let agent = null;
let _ready = false;
let _da = null; // DAAdapter singleton for broadcasts

function rankedAllocation(marketData) {
  const yields = [
    { name: "aave", apy: Number(marketData?.aave_apy ?? 0) },
    { name: "morpho", apy: Number(marketData?.morpho_apy ?? 0) },
    { name: "yearn", apy: Number(marketData?.yearn_apy ?? 0) },
    { name: "sky", apy: Number(marketData?.sky_apy ?? 0) },
  ].sort((a, b) => b.apy - a.apy);
  const weights = [50, 30, 15, 5];
  return yields.reduce((out, item, index) => {
    out[item.name] = weights[index];
    return out;
  }, {});
}

function normaliseAllocation(output, marketData) {
  const allocation = output && typeof output === "object" ? output : {};
  const values = ["aave", "morpho", "yearn", "sky"].map((key) => Number(allocation[key]));
  const sum = values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);

  if (
    values.some((value) => !Number.isFinite(value)) ||
    values.some((value) => value <= 0) ||
    Math.abs(sum - 100) > 1
  ) {
    return rankedAllocation(marketData);
  }

  return {
    aave: Math.round(values[0]),
    morpho: Math.round(values[1]),
    yearn: Math.round(values[2]),
    sky: Math.round(values[3]),
  };
}

function buildAgent() {
  const chainRpc = process.env.ZG_CHAIN_RPC ?? "https://evmrpc-testnet.0g.ai";
  const storageRpc = process.env.ZG_STORAGE_RPC ?? "https://indexer-storage-testnet-turbo.0g.ai";
  const privateKey = process.env.ZG_PRIVATE_KEY;
  const registryAddress = process.env.SKILL_REGISTRY_ADDRESS?.trim() || null;

  const hasStorage = !!(privateKey && storageRpc);
  const hasChain = !!(privateKey && registryAddress);

  // ── viem clients (only when chain config is present) ──────────────
  let walletClient = null;
  let publicClient = null;
  let agentAddress = "0x0000000000000000000000000000000000000000";

  if (hasChain) {
    const account = privateKeyToAccount(privateKey);
    agentAddress = account.address;
    walletClient = createWalletClient({
      account,
      chain: ZG_CHAIN,
      transport: http(chainRpc),
    });
    publicClient = createPublicClient({
      chain: ZG_CHAIN,
      transport: http(chainRpc),
    });
    console.log(`  ⛓  0G Chain: on-chain registration enabled (${registryAddress})`);
  }

  // ── SkillRegistry adapter ──────────────────────────────────────────
  // Built first so we can pass chainRootHashLookup into StorageAdapter below.
  const registryAdapter = new SkillRegistryAdapter(
    hasChain
      ? {
          contractAddress: registryAddress,
          agentAddress,
          walletClient,
          publicClient,
        }
      : { localMode: true },
  );

  // ── 0G Storage adapter ─────────────────────────────────────────────
  // When the chain is available, wire chainRootHashLookup so fetchGenome()
  // can resolve a 0G rootHash from the on-chain SkillRegistry instead of
  // depending solely on the local .evoframe-cache.json hashIndex.
  const storageAdapter = new StorageAdapter(
    hasStorage
      ? {
          storageRpcUrl: storageRpc,
          chainRpcUrl: chainRpc,
          privateKey,
          localCachePath: resolve(ROOT, ".evoframe-cache.json"),
          chainRootHashLookup: hasChain
            ? (skillId) => registryAdapter.getStorageHash(skillId)
            : undefined,
        }
      : {
          localMode: true,
          localCachePath: resolve(ROOT, ".evoframe-cache.json"),
        },
  );

  // ── 0G DA adapter (cross-agent broadcast) ─────────────────────────
  _da = new DAAdapter(
    hasStorage
      ? {
          storageRpcUrl: storageRpc,
          chainRpcUrl: chainRpc,
          privateKey,
          localManifestPath: resolve(ROOT, ".evoframe-broadcast.json"),
        }
      : {
          localMode: true,
          localManifestPath: resolve(ROOT, ".evoframe-broadcast.json"),
        },
  );

  return new EvoYieldAgent(
    {
      agentName: "EvoYield-v1",
      agentPrivateKey: privateKey ?? "0x" + "00".repeat(32),
      skillRegistryAddress: registryAddress ?? "0x0000000000000000000000000000000000000001",
      chainRpcUrl: chainRpc,
      storageRpcUrl: storageRpc,
      daRpcUrl: process.env.ZG_DA_RPC ?? "http://localhost:9001",
      computeEndpoint: process.env.COMPUTE_ENDPOINT,
      evolutionModel: process.env.EVOLUTION_MODEL ?? "qwen/qwen-2.5-7b-instruct",
      fitnessThreshold: 60,
      maxCandidatesPerCycle: 2,
      autoRegisterOnChain: hasChain,
    },
    storageAdapter,
    new ComputeAdapter({
      computeEndpoint: process.env.COMPUTE_ENDPOINT,
      apiKey: process.env.ZG_API_KEY,
      mode: process.env.COMPUTE_MODE ?? "live",
      zgPrivateKey: process.env.ZG_PRIVATE_KEY,
      zgProviderAddress: process.env.ZG_COMPUTE_PROVIDER,
      zgRpcUrl: process.env.ZG_CHAIN_RPC ?? "https://evmrpc-testnet.0g.ai",
    }),
    registryAdapter,
  );
}

export async function initAgent() {
  if (_ready) return;
  agent = buildAgent();

  agent.getEngine().on(async (e) => {
    if (e.type === "mutation_requested") console.log("\n🧬 Evolving strategy via 0G compute...");
    if (e.type === "candidate_generated") process.stdout.write(".");
    if (e.type === "skill_promoted") {
      console.log(" ✅ New strategy promoted!");
      // Broadcast the promoted skill to the 0G DA channel so other agents can discover it
      try {
        const skill = getActiveSkill();
        if (skill && _da) {
          // Get the 0G rootHash if storage was live
          const storageAdapter = agent?.getStorageAdapter?.();
          const rootHash = storageAdapter?.getRootHash?.(skill.storageKey) ?? null;
          await _da.broadcastSkill(skill, "EvoYield-v1", rootHash);
        }
      } catch (err) {
        // best-effort — don't fail evolution if DA broadcast errors
        console.warn(`  ⚠️  DA broadcast failed: ${err.message ?? err}`);
      }
    }
    if (e.type === "evolution_failed") console.log(" ❌ Evolution failed");
  });

  console.log("⏳ Initialising EvoYield agent...");
  await agent.initialize();

  const skill = getSkillInfo();
  console.log(`✅ Agent ready — gen-${skill?.generation}, fitness=${skill?.fitnessScore}`);
  _ready = true;
}

export async function evaluate(marketData) {
  if (!agent) throw new Error("Agent not initialized. Call initAgent() first.");

  const result = await agent.run({
    id: `eval-${Date.now()}`,
    description: "Evaluate yield allocation",
    input: marketData,
    domain: "defi",
  });

  const skill = getSkillInfo();
  return {
    allocation: normaliseAllocation(result.output, marketData),
    generation: skill?.generation ?? 0,
    fitnessScore: skill?.fitnessScore ?? 0,
  };
}

export function getSkillInfo() {
  const skill = agent?.listSkills().find((s) => s.name === "yield-allocator");
  return skill
    ? { name: skill.name, generation: skill.generation, fitnessScore: skill.fitnessScore }
    : null;
}

/** Returns the underlying EvoAgent so KeeperHub modules can subscribe to engine events. */
export function getAgent() {
  return agent;
}

/** Returns the current active SkillGenome, or null if the agent is not ready. */
export function getActiveSkill() {
  return agent?.listSkills().find((s) => s.name === "yield-allocator") ?? null;
}

/**
 * Force the agent to re-evaluate fitness and (if needed) trigger a new
 * evolution cycle. Used by the KeeperHub-callable /regenerate route when an
 * onchain workflow detects a sustained underperformance.
 */
export async function forceRegenerate(reason = "external regeneration trigger") {
  if (!agent) throw new Error("Agent not initialized");
  return agent.forceEvolve("yield-allocator", reason);
}

/** Returns the DAAdapter singleton (for external broadcast/discover calls) */
export function getDAAdapter() {
  return _da;
}
