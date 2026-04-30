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
  const directWebhookUrl = (process.env.KH_WEBHOOK_URL ?? "").trim();

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

  // Preferred path for KeeperHub webhook-trigger workflows that provide
  // a direct signed URL in the UI (no org API key needed).
  if (directWebhookUrl) {
    const res = await fetch(directWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "evoyield-keeperhub/1.0",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (res.ok) {
      console.log(`\n⚡ KeeperHub workflow triggered (direct webhook URL)`);
      return { triggered: true, workflowId: id, result: json };
    }
    return {
      triggered: false,
      workflowId: id,
      unavailable: true,
      error: json?.error ?? `Direct webhook call failed (${res.status})`,
    };
  }

  const path = via === "execute" ? PATHS.execute(id) : PATHS.webhook(id);
  try {
    const result = await kh.post(path, via === "execute" ? { input: payload } : payload, {
      idempotencyKey: `trigger:${id}:${generation}:${Date.now()}`,
    });
    console.log(`\n⚡ KeeperHub workflow triggered (${id})`);
    return { triggered: true, workflowId: id, result };
  } catch (err) {
    if (err instanceof KeeperHubError && via === "webhook" && err.status === 401) {
      const msg = String(err.body?.error ?? "").toLowerCase();
      const webhookKey = (process.env.KH_WEBHOOK_KEY ?? "").trim();
      if (msg.includes("invalid api key format") && webhookKey.startsWith("wfb_")) {
        const base = (process.env.KEEPERHUB_API_URL ?? "https://app.keeperhub.com/api").replace(/\/+$/, "");
        const res = await fetch(`${base}${PATHS.webhook(id)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-API-Key": webhookKey,
            "User-Agent": "evoyield-keeperhub/1.0",
          },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        let json;
        try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
        if (res.ok) {
          console.log(`\n⚡ KeeperHub workflow triggered (${id}, webhook-key auth)`);
          return { triggered: true, workflowId: id, result: json };
        }
        return {
          triggered: false,
          workflowId: id,
          unavailable: true,
          error: json?.error ?? `Webhook key auth failed (${res.status})`,
        };
      }
    }

    if (err instanceof KeeperHubError && via === "webhook" && err.status === 410) {
      // Workflow exists but is not active for webhook trigger.
      // Surface a clear, actionable signal to the caller instead of attempting
      // /execute, which is not guaranteed to exist in all KeeperHub API shapes.
      return {
        triggered: false,
        workflowId: id,
        disabled: true,
        error: err.body?.error ?? "Workflow is disabled",
      };
    }

    if (err instanceof KeeperHubError && err.status === 404 && via === "webhook") {
      // Some KeeperHub deployments expose an execute route instead of webhook.
      // Best effort fallback: if execute is also unavailable, surface a clean
      // non-fatal response so cycle logs can guide manual configuration.
      try {
        const result = await kh.post(PATHS.execute(id), { input: payload });
        console.log(`\n⚡ KeeperHub workflow executed (${id}, fallback to /execute)`);
        return { triggered: true, workflowId: id, result };
      } catch (execErr) {
        if (execErr instanceof KeeperHubError && execErr.status === 404) {
          return {
            triggered: false,
            workflowId: id,
            unavailable: true,
            error: "Neither /webhook nor /execute endpoint is available for this workflow.",
          };
        }
        throw execErr;
      }
    }
    throw err;
  }
}
