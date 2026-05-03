import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readJson, writeJsonAtomic } from "./fs.mjs";
import { getExecutableProtocols, getProtocolTargets } from "./protocolTargets.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(__dirname, "../../.evoyield-allocation-state.json");

const PROTOCOLS = ["aave", "morpho", "yearn", "sky"];
const DEFAULT_POOL_USDC = 60.1;

function normalizeAllocation(allocation = {}) {
  return Object.fromEntries(
    PROTOCOLS.map((protocol) => [protocol, Number(allocation[protocol] ?? 0)]),
  );
}

function amountsFor(allocation, poolUsdc) {
  const normalized = normalizeAllocation(allocation);
  return Object.fromEntries(
    PROTOCOLS.map((protocol) => [
      protocol,
      Number(((poolUsdc * normalized[protocol]) / 100).toFixed(6)),
    ]),
  );
}

function allocationFromAmounts(amounts = {}, poolUsdc) {
  if (!poolUsdc) return { aave: 0, morpho: 0, yearn: 0, sky: 0 };

  return Object.fromEntries(
    PROTOCOLS.map((protocol) => [
      protocol,
      Number(((Number(amounts[protocol] ?? 0) / poolUsdc) * 100).toFixed(6)),
    ]),
  );
}

export async function buildRebalanceContext(nextAllocation, {
  poolUsdc = Number(process.env.EVOYIELD_TEST_POOL_USDC ?? DEFAULT_POOL_USDC),
} = {}) {
  const state = await readJson(STORE_PATH, {
    poolUsdc,
    currentAllocation: null,
    currentAmounts: null,
    updatedAt: null,
  });

  const previousAmounts = state.currentAmounts
    ?? amountsFor(state.currentAllocation ?? { aave: 0, morpho: 0, yearn: 0, sky: 0 }, state.poolUsdc ?? poolUsdc);
  const previousAllocation = allocationFromAmounts(previousAmounts, poolUsdc);
  const targetAllocation = normalizeAllocation(nextAllocation);
  const targetAmounts = amountsFor(targetAllocation, poolUsdc);

  const deltas = Object.fromEntries(
    PROTOCOLS.map((protocol) => {
      const delta = Number((targetAmounts[protocol] - (previousAmounts[protocol] ?? 0)).toFixed(6));
      return [
        protocol,
        {
          protocol,
          previousPct: Number(previousAllocation[protocol] ?? 0),
          targetPct: targetAllocation[protocol],
          previousAmountUsdc: Number(previousAmounts[protocol] ?? 0),
          targetAmountUsdc: targetAmounts[protocol],
          deltaUsdc: delta,
          action: delta > 0 ? "deposit" : delta < 0 ? "withdraw" : "hold",
        },
      ];
    }),
  );

  return {
    poolUsdc,
    previousAllocation: normalizeAllocation(previousAllocation),
    previousAmounts,
    targetAllocation,
    targetAmounts,
    deltas,
    protocolTargets: getProtocolTargets(),
    executableProtocols: getExecutableProtocols(),
    isInitialAllocation: !state.currentAllocation,
  };
}

export async function recordAllocationState(allocation, {
  poolUsdc = Number(process.env.EVOYIELD_TEST_POOL_USDC ?? DEFAULT_POOL_USDC),
  workflowId,
  executionId,
} = {}) {
  const currentAllocation = normalizeAllocation(allocation);
  await writeJsonAtomic(STORE_PATH, {
    poolUsdc,
    currentAllocation,
    currentAmounts: amountsFor(currentAllocation, poolUsdc),
    workflowId,
    executionId,
    updatedAt: new Date().toISOString(),
  });
}
