/**
 * config.ts — EvoFrame agent configuration
 *
 * All values come from .env — see .env.example for what to set.
 * This is the only place you need to touch to point the agent at
 * a different 0G network, model, or skill registry.
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import type { EvoFrameConfig } from "@evoframe/core";

// Load .env from this package's root, regardless of where the process is started
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

export const config: EvoFrameConfig = {
  agentPrivateKey: process.env["AGENT_PRIVATE_KEY"] ?? "0x" + "00".repeat(32),
  agentName: "ResearchEvolver-v1",
  skillRegistryAddress:
    process.env["SKILL_REGISTRY_ADDRESS"] ?? "0x0000000000000000000000000000000000000001",
  chainRpcUrl: process.env["CHAIN_RPC_URL"] ?? "https://evmrpc-testnet.0g.ai",
  storageRpcUrl: process.env["STORAGE_RPC_URL"] ?? "https://indexer-storage-testnet-turbo.0g.ai",
  daRpcUrl: process.env["DA_RPC_URL"] ?? "https://da-node-testnet.0g.ai",
  computeEndpoint:
    process.env["COMPUTE_ENDPOINT"] ?? "https://compute-network-6.integratenetwork.work",
  evolutionModel: process.env["EVOLUTION_MODEL"] ?? "qwen/qwen-2.5-7b-instruct",
  fitnessThreshold: 45,
  maxCandidatesPerCycle: 2,
  autoRegisterOnChain: false,
};
