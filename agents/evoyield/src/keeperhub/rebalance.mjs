// Triggers the KeeperHub rebalance workflow via webhook.
// The workflow (built by friend in KeeperHub UI) receives the evolved allocation
// and executes the onchain rebalance across Aave / Morpho / Yearn / Sky.
//
// KeeperHub Webhook docs: https://docs.keeperhub.com/api/workflows#webhook-trigger
//
// ── FRIEND: What your KeeperHub workflow should do ──────────────
//  Trigger: Webhook (this file calls it)
//  Nodes:
//   1. Receive webhook payload: { allocation, marketData, generation, fitnessScore, timestamp }
//   2. Read current balances on Aave V3, Morpho, Yearn, Sky
//   3. Calculate delta (what needs to move)
//   4. Withdraw from over-allocated protocols
//   5. Approve + Deposit into under-allocated protocols
//   6. Confirm updated balances
//   7. Send Telegram / Discord summary
//
//  Set KH_REBALANCE_WORKFLOW_ID in .env after creating the workflow.

import { khFetch } from "./client.mjs";

export async function triggerRebalance({ allocation, marketData, generation, fitnessScore }) {
  const workflowId = process.env.KH_REBALANCE_WORKFLOW_ID;

  const payload = {
    allocation,    // { aave: %, morpho: %, yearn: %, sky: % }
    marketData,    // { aave_apy, morpho_apy, yearn_apy, sky_apy }
    generation,    // which evolution generation produced this strategy
    fitnessScore,
    timestamp: new Date().toISOString(),
  };

  if (!workflowId || workflowId === "wf_your_workflow_id_here") {
    console.log("\n⚠️  KH_REBALANCE_WORKFLOW_ID not set — logging payload only:");
    console.log(JSON.stringify(payload, null, 2).split("\n").map((l) => "   " + l).join("\n"));
    return { triggered: false, payload };
  }

  const result = await khFetch(`/workflows/${workflowId}/webhook`, {
    method: "POST",
    body:   payload,
  });

  console.log(`\n⚡ KeeperHub workflow triggered (${workflowId})`);
  return { triggered: true, result };
}
