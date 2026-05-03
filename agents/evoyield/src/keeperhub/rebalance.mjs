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
import { getExecutionLogs, waitForExecution } from "./checkAndExecute.mjs";

const PATHS = {
  webhook: (id) => `/workflows/${encodeURIComponent(id)}/webhook`,
  execute: (id) => `/workflow/${encodeURIComponent(id)}/execute`,
};

function executionIdFrom(result) {
  return (
    result?.execution_id ??
    result?.executionId ??
    result?.id ??
    result?.execution?.id ??
    result?.run_id ??
    result?.runId ??
    null
  );
}

function workflowStatusFrom(result) {
  return result?.status ?? result?.execution?.status ?? result?.state ?? null;
}

function printJsonBlock(label, value, indent = "      ") {
  if (value == null) return;
  const text = JSON.stringify(value, null, 2)
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
  console.log(`${indent}${label}:`);
  console.log(text);
}

function printExecutionLogs(logResp) {
  const execution = logResp?.execution;
  const logs = Array.isArray(logResp?.logs) ? logResp.logs : [];

  if (execution?.output !== undefined) {
    printJsonBlock("Workflow output", execution.output, "   ");
  }

  if (logs.length) {
    console.log("   ↳ node outputs:");
    for (const log of logs) {
      const duration = log.duration != null ? ` (${log.duration}ms)` : "";
      console.log(`      • ${log.nodeName ?? log.nodeId}: ${log.status}${duration}`);
      if (log.output !== undefined) {
        printJsonBlock("output", log.output, "        ");
      }
      if (log.error) {
        printJsonBlock("error", log.error, "        ");
      }
    }
  }
}

async function confirmExecution(
  result,
  {
    workflowId,
    source,
    wait = false,
    timeoutMs = Number(process.env.KH_WORKFLOW_WAIT_MS ?? 45_000),
  } = {},
) {
  const executionId = executionIdFrom(result);
  const status = workflowStatusFrom(result);
  const out = {
    triggered: true,
    workflowId,
    executionId,
    status,
    source,
    result,
    triggeredAt: new Date().toISOString(),
  };

  const statusText = status ? `, status=${status}` : "";
  const executionText = executionId ? `, execution=${executionId}` : "";
  console.log(`\n⚡ KeeperHub workflow triggered (${workflowId}${executionText}${statusText})`);

  if (wait && executionId) {
    try {
      const final = await waitForExecution(executionId, { timeoutMs });
      out.finalStatus = workflowStatusFrom(final) ?? final?.status ?? "unknown";
      out.finalResult = final;
      console.log(`   ↳ execution ${executionId} ${out.finalStatus}`);
      const logs = await getExecutionLogs(executionId);
      out.logs = logs;
      printExecutionLogs(logs);
    } catch (err) {
      out.confirmationError = err.message ?? String(err);
      console.warn(`   ↳ execution confirmation unavailable: ${out.confirmationError}`);
    }
  }

  if (!executionId) {
    const keys =
      result && typeof result === "object" ? Object.keys(result).join(", ") : typeof result;
    console.warn(
      `   ↳ KeeperHub accepted the trigger but did not return an execution id (${keys || "empty response"})`,
    );
  }

  return out;
}

export async function triggerRebalance({
  allocation,
  marketData,
  generation,
  fitnessScore,
  rebalance,
  workflowId, // optional — overrides the env var (used by auto-synth)
  via = "webhook", // "webhook" or "execute"
  wait = (process.env.KH_WAIT_FOR_WORKFLOW ?? "").toLowerCase() === "true",
} = {}) {
  const id = workflowId ?? process.env.KH_REBALANCE_WORKFLOW_ID;
  const directWebhookUrl = (process.env.KH_WEBHOOK_URL ?? "").trim();

  const payload = {
    allocation,
    marketData,
    generation,
    fitnessScore,
    ...(rebalance ? { rebalance } : {}),
    timestamp: new Date().toISOString(),
  };

  if (!id || id === "wf_your_workflow_id_here") {
    console.log("\n⚠️  No KeeperHub workflow registered — logging payload only:");
    console.log(
      JSON.stringify(payload, null, 2)
        .split("\n")
        .map((l) => "   " + l)
        .join("\n"),
    );
    return { triggered: false, payload };
  }

  // Auto-patch the workflow with static BPS immediately before triggering
  try {
    const wf = await kh.get(`/workflows/${encodeURIComponent(id)}`);
    
    // Calculate BPS from percentage allocation
    const aaveBps = Math.floor((allocation.aave || 0) * 100);
    const morphoBps = Math.floor((allocation.morpho || 0) * 100);
    const yearnBps = Math.floor((allocation.yearn || 0) * 100);
    const skyBps = Math.floor((allocation.sky || 0) * 100);
    
    let patched = false;
    let newNodes = wf?.nodes;
    
    if (newNodes && Array.isArray(newNodes)) {
      for (const node of newNodes) {
        const config = node.data?.config;
        if ((config?.abiFunction === "rebalanceAmountToTargets" || config?.functionName === "rebalanceAmountToTargets") && config?.functionArgs) {
          let args;
          try {
             args = JSON.parse(config.functionArgs);
          } catch(e) {}
          
          if (Array.isArray(args) && args.length === 5) {
             args[1] = aaveBps.toString();
             args[2] = morphoBps.toString();
             args[3] = yearnBps.toString();
             args[4] = skyBps.toString();
             config.functionArgs = JSON.stringify(args);
             patched = true;
          } else if (typeof args === "object" && args !== null) {
             args.aaveBps = aaveBps.toString();
             args.morphoBps = morphoBps.toString();
             args.yearnBps = yearnBps.toString();
             args.skyBps = skyBps.toString();
             config.functionArgs = JSON.stringify(args);
             patched = true;
          } else {
             // Fallback if the previous parsing was weird
             config.functionArgs = JSON.stringify({
                poolAssets: "100000",
                aaveBps: aaveBps.toString(),
                morphoBps: morphoBps.toString(),
                yearnBps: yearnBps.toString(),
                skyBps: skyBps.toString()
             });
             patched = true;
          }
        }
      }
    }
    
    if (patched) {
      console.log(`   ↳ Auto-patching workflow ${id} write node with static BPS: aave=${aaveBps}, morpho=${morphoBps}, yearn=${yearnBps}, sky=${skyBps}`);
      await kh.patch(`/workflows/${encodeURIComponent(id)}`, { nodes: newNodes });
    }
  } catch (err) {
    console.warn("   ↳ Failed to auto-patch workflow BPS:", err.message);
  }

  // Preferred path for KeeperHub webhook-trigger workflows that provide
  // a direct signed URL in the UI (no org API key needed). If that URL has
  // gone stale, fall through to the authenticated workflow API below.
  if (directWebhookUrl) {
    const webhookKey = (process.env.KH_WEBHOOK_KEY ?? "").trim();
    const directHeaders = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "evoyield-keeperhub/1.0",
    };
    if (webhookKey) directHeaders["X-API-Key"] = webhookKey;
    const res = await fetch(directWebhookUrl, {
      method: "POST",
      headers: directHeaders,
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (res.ok) {
      return confirmExecution(json, { workflowId: id, source: "direct-webhook-url", wait });
    }
  }

  const path = via === "execute" ? PATHS.execute(id) : PATHS.webhook(id);
  try {
    const result = await kh.post(path, via === "execute" ? { input: payload } : payload, {
      idempotencyKey: `trigger:${id}:${generation}:${Date.now()}`,
    });
    return confirmExecution(result, { workflowId: id, source: via, wait });
  } catch (err) {
    if (err instanceof KeeperHubError && via === "webhook" && err.status === 401) {
      const msg = String(err.body?.error ?? "").toLowerCase();
      const webhookKey = (process.env.KH_WEBHOOK_KEY ?? "").trim();
      if (msg.includes("invalid api key format")) {
        try {
          const result = await kh.post(
            PATHS.execute(id),
            { input: payload },
            {
              idempotencyKey: `execute:${id}:${generation}:${Date.now()}`,
            },
          );
          return confirmExecution(result, {
            workflowId: id,
            source: "execute-auth-fallback",
            wait,
          });
        } catch (execErr) {
          if (execErr instanceof KeeperHubError && execErr.status === 403) {
            return {
              triggered: false,
              workflowId: id,
              authFailed: true,
              error: execErr.body?.error ?? "You do not have permission to run this workflow",
            };
          }
          if (!(execErr instanceof KeeperHubError) || execErr.status !== 404) {
            throw execErr;
          }
        }
      }
      if (msg.includes("invalid api key format") && webhookKey.startsWith("kh_")) {
        return {
          triggered: false,
          workflowId: id,
          authFailed: true,
          error:
            "KH_WEBHOOK_KEY is an organization key (kh_...). KeeperHub webhook triggers require a user webhook key (wfb_...).",
        };
      }
      if (msg.includes("invalid api key format") && webhookKey) {
        const base = (process.env.KEEPERHUB_API_URL ?? "https://app.keeperhub.com/api").replace(
          /\/+$/,
          "",
        );
        const res = await fetch(`${base}${PATHS.webhook(id)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${webhookKey}`,
            "X-API-Key": webhookKey,
            "User-Agent": "evoyield-keeperhub/1.0",
          },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        let json;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { raw: text };
        }
        if (res.ok) {
          return confirmExecution(json, { workflowId: id, source: "webhook-key", wait });
        }
        return {
          triggered: false,
          workflowId: id,
          unavailable: true,
          error: json?.error ?? `Webhook key auth failed (${res.status})`,
        };
      }
      return {
        triggered: false,
        workflowId: id,
        authFailed: true,
        error: err.body?.error ?? "KeeperHub rejected the workflow trigger API key.",
      };
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
        return confirmExecution(result, { workflowId: id, source: "execute-fallback", wait });
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
