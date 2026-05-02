import { createRequire } from "module";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { triggerRebalance } from "../src/keeperhub/rebalance.mjs";
import { buildRebalanceContext, recordAllocationState } from "../src/keeperhub/allocationState.mjs";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require("dotenv").config({ path: resolve(__dirname, "../.env") });

const scenarios = [
  {
    label: "Morpho demand spike",
    timestamp: "2026-05-02T16:05:00.000Z",
    marketData: { aave_apy: 3.2, morpho_apy: 6.9, yearn_apy: 4.1, sky_apy: 0.8 },
    allocation: { aave: 15, morpho: 50, yearn: 30, sky: 5 },
  },
  {
    label: "Yearn vault improves",
    timestamp: "2026-05-02T16:22:00.000Z",
    marketData: { aave_apy: 3.4, morpho_apy: 4.5, yearn_apy: 7.2, sky_apy: 1.1 },
    allocation: { aave: 15, morpho: 30, yearn: 50, sky: 5 },
  },
  {
    label: "Aave becomes safest top yield",
    timestamp: "2026-05-02T16:41:00.000Z",
    marketData: { aave_apy: 6.4, morpho_apy: 4.8, yearn_apy: 3.7, sky_apy: 1.2 },
    allocation: { aave: 50, morpho: 30, yearn: 15, sky: 5 },
  },
];

function expectedApy(allocation, marketData) {
  return Object.entries(allocation).reduce((sum, [protocol, pct]) => {
    return sum + (Number(pct) / 100) * Number(marketData[`${protocol}_apy`] ?? 0);
  }, 0);
}

const history = [];

for (const scenario of scenarios) {
  const rebalance = await buildRebalanceContext(scenario.allocation);
  const previousExpectedApy = expectedApy(rebalance.previousAllocation, scenario.marketData);
  const targetExpectedApy = expectedApy(rebalance.targetAllocation, scenario.marketData);

  console.log(`\n=== ${scenario.label} ===`);
  console.log(`Previous expected APY: ${previousExpectedApy.toFixed(2)}%`);
  console.log(`Target expected APY:   ${targetExpectedApy.toFixed(2)}%`);

  const khResult = await triggerRebalance({
    allocation: scenario.allocation,
    marketData: scenario.marketData,
    generation: 3,
    fitnessScore: 100,
    rebalance,
    workflowId: process.env.KH_REBALANCE_WORKFLOW_ID,
    wait: true,
  });

  if (khResult?.triggered) {
    await recordAllocationState(scenario.allocation, {
      poolUsdc: rebalance.poolUsdc,
      workflowId: khResult.workflowId,
      executionId: khResult.executionId,
    });
  }

  history.push({
    label: scenario.label,
    timestamp: scenario.timestamp,
    marketData: scenario.marketData,
    previousAllocation: rebalance.previousAllocation,
    targetAllocation: rebalance.targetAllocation,
    previousAmounts: rebalance.previousAmounts,
    targetAmounts: rebalance.targetAmounts,
    deltas: Object.values(rebalance.deltas),
    previousExpectedApy: Number(previousExpectedApy.toFixed(2)),
    targetExpectedApy: Number(targetExpectedApy.toFixed(2)),
    expectedApyLift: Number((targetExpectedApy - previousExpectedApy).toFixed(2)),
    executionId: khResult?.executionId ?? null,
    status: khResult?.finalStatus ?? khResult?.status ?? "unknown",
  });
}

console.log("\n=== History JSON ===");
console.log(JSON.stringify(history, null, 2));
