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
//   7. Send Discord summary
//
//  Set KH_REBALANCE_WORKFLOW_ID in .env after creating the workflow.

import { kh, KeeperHubError } from "./client.mjs";

const PATHS = {
  webhook: (id) => `/workflows/${encodeURIComponent(id)}/webhook`,
  execute: (id) => `/workflows/${encodeURIComponent(id)}/execute`,
};

export async function triggerRebalance({
  allocation,
  marketData,
  generation,
  fitnessScore,
  workflowId,                    // optional — overrides the env var (used by auto-synth)
  via = "webhook",               // "webhook" or "execute"
} = {}) {
  const id = workflowId ?? process.env.KH_REBALANCE_WORKFLOW_ID;

  const payload = {
    allocation,
    marketData,
    generation,
    fitnessScore,
    timestamp: new Date().toISOString(),
  };

  if (!id || id === "wf_your_workflow_id_here") {
    console.log("\n⚠️  No KeeperHub workflow registered — logging payload only:");
    console.log(JSON.stringify(payload, null, 2).split("\n").map((l) => "   " + l).join("\n"));
    return { triggered: false, payload };
  }

  const path = via === "execute" ? PATHS.execute(id) : PATHS.webhook(id);
  try {
    const result = await kh.post(path, via === "execute" ? { input: payload } : payload, {
      idempotencyKey: `trigger:${id}:${generation}:${Date.now()}`,
    });
    console.log(`\n⚡ KeeperHub workflow triggered (${id})`);
    return { triggered: true, workflowId: id, result };
  } catch (err) {
    if (err instanceof KeeperHubError && err.status === 404 && via === "webhook") {
      // Workflow exists but doesn't have a webhook trigger — fall back to execute.
      const result = await kh.post(PATHS.execute(id), { input: payload });
      console.log(`\n⚡ KeeperHub workflow executed (${id}, fallback to /execute)`);
      return { triggered: true, workflowId: id, result };
    }
    throw err;
  }
}
