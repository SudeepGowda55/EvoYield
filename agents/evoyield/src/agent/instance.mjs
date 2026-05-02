// Singleton agent instance shared across server routes and KeeperHub cycle.
// Entry points (agent.mjs / server.mjs / keeperhub.mjs) load dotenv before
// importing this module, so process.env.* is available inside functions.

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

import { EvoYieldAgent } from "./EvoYieldAgent.mjs";
import { StorageAdapter, ComputeAdapter } from "@evoframe/0g-adapter";
import { SkillRegistryAdapter } from "@evoframe/skill-registry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "../../");

let agent      = null;
let _ready     = false;

function rankedAllocation(marketData) {
  const yields = [
    { name: "aave",   apy: Number(marketData?.aave_apy ?? 0) },
    { name: "morpho", apy: Number(marketData?.morpho_apy ?? 0) },
    { name: "yearn",  apy: Number(marketData?.yearn_apy ?? 0) },
    { name: "sky",    apy: Number(marketData?.sky_apy ?? 0) },
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
    aave:   Math.round(values[0]),
    morpho: Math.round(values[1]),
    yearn:  Math.round(values[2]),
    sky:    Math.round(values[3]),
  };
}

function buildAgent() {
  return new EvoYieldAgent(
    {
      agentName:             "EvoYield-v1",
      agentPrivateKey:       "0x" + "00".repeat(32),
      skillRegistryAddress:  "0x0000000000000000000000000000000000000001",
      chainRpcUrl:           "http://localhost:8545",
      storageRpcUrl:         "http://localhost:9000",
      daRpcUrl:              "http://localhost:9001",
      computeEndpoint:       process.env.COMPUTE_ENDPOINT,
      evolutionModel:        process.env.EVOLUTION_MODEL ?? "qwen/qwen-2.5-7b-instruct",
      fitnessThreshold:      60,
      maxCandidatesPerCycle: 2,
      autoRegisterOnChain:   false,
    },
    new StorageAdapter({
      localMode:      true,
      localCachePath: resolve(ROOT, ".evoframe-cache.json"),
    }),
    new ComputeAdapter({
      computeEndpoint: process.env.COMPUTE_ENDPOINT,
      apiKey:          process.env.ZG_API_KEY,
      mode:            process.env.COMPUTE_MODE ?? "live",
    }),
    new SkillRegistryAdapter({ localMode: true })
  );
}

export async function initAgent() {
  if (_ready) return;
  agent = buildAgent();

  agent.getEngine().on((e) => {
    if (e.type === "mutation_requested")  console.log("\n🧬 Evolving strategy via 0G compute...");
    if (e.type === "candidate_generated") process.stdout.write(".");
    if (e.type === "skill_promoted")      console.log(" ✅ New strategy promoted!");
    if (e.type === "evolution_failed")    console.log(" ❌ Evolution failed");
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
    id:          `eval-${Date.now()}`,
    description: "Evaluate yield allocation",
    input:       marketData,
    domain:      "defi",
  });

  const skill = getSkillInfo();
  return {
    allocation:   normaliseAllocation(result.output, marketData),
    generation:   skill?.generation   ?? 0,
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
