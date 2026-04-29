/**
 * @evoframe/skill-registry — DeploymentHelper
 *
 * Utility to deploy SkillRegistry.sol + SkillToken.sol to 0G Chain via viem.
 * Run via: evo deploy
 */

import type { WalletClient, PublicClient, Address } from "viem";

export interface DeploymentResult {
  skillRegistryAddress: string;
  skillTokenAddress: string;
  deployTxRegistry: string;
  deployTxToken: string;
}

// Bytecode placeholder — replaced by actual compiled bytecode at build time
// In a real deployment, use hardhat/foundry artifacts
export const SKILL_REGISTRY_BYTECODE = "0x" as `0x${string}`;
export const SKILL_TOKEN_BYTECODE = "0x" as `0x${string}`;

export async function deployContracts(
  walletClient: WalletClient,
  publicClient: PublicClient,
  deployerAddress: Address,
): Promise<DeploymentResult> {
  // 1. Deploy SkillToken
  const tokenHash = await walletClient.deployContract({
    abi: [],
    bytecode: SKILL_TOKEN_BYTECODE,
    account: deployerAddress,
    chain: null,
  });
  const tokenReceipt = await publicClient.waitForTransactionReceipt({
    hash: tokenHash as Hash,
  });

  // 2. Deploy SkillRegistry
  const registryHash = await walletClient.deployContract({
    abi: [],
    bytecode: SKILL_REGISTRY_BYTECODE,
    account: deployerAddress,
    chain: null,
  });
  const registryReceipt = await publicClient.waitForTransactionReceipt({
    hash: registryHash as Hash,
  });

  return {
    skillRegistryAddress: registryReceipt.contractAddress ?? "",
    skillTokenAddress: tokenReceipt.contractAddress ?? "",
    deployTxRegistry: registryHash,
    deployTxToken: tokenHash,
  };
}

type Hash = `0x${string}`;
