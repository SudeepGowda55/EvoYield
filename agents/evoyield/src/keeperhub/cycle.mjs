// Full EvoYield cycle, KeeperHub edition.
//
//   1. Fetch live APY data (DefiLlama)
//   2. Ask the evolved agent for an allocation (EvoFrame / 0G)
//   3. If a new generation was just promoted, synthesise a matching
//      KeeperHub workflow (genome-to-keeper auto-synthesis)
//   4. Trigger the current generation's KeeperHub workflow with the
//      fresh allocation, OR fall back to a direct check-and-execute
//      contract call when no workflow is registered yet
//   5. Send a Discord notification

import { fetchApyData }                    from "./apy.mjs";
import { triggerRebalance }                from "./rebalance.mjs";
import { sendDiscord, formatCycleMessage } from "./notify.mjs";
import { synthesiseWorkflow }              from "./synth.mjs";
import { snapshot, recordDeployment }       from "./registry.mjs";
import { KeeperHubError }                  from "./client.mjs";
import { initAgent, evaluate, getActiveSkill } from "../agent/instance.mjs";

export async function runCycle({ allowSynth = true, agentName = "EvoYield-v1" } = {}) {
  console.log("\n" + "═".repeat(60));
  console.log(`🔄  EvoYield Cycle   ${new Date().toLocaleTimeString()}`);
  console.log("═".repeat(60));

  // 1. Boot agent (idempotent)
  await initAgent();

  // 2. Live market data
  const marketData = await fetchApyData();

  // 3. Ask the evolved strategy for an allocation
  console.log("\n🤖 Computing allocation...");
  const result = await evaluate(marketData);
  const { aave, morpho, yearn, sky } = result.allocation ?? {};
  console.log(`   Aave: ${aave}%  |  Morpho: ${morpho}%  |  Yearn: ${yearn}%  |  Sky: ${sky}%`);
  console.log(`   Strategy: gen-${result.generation}, fitness=${result.fitnessScore}`);

  // 4. Auto-synthesise a KeeperHub workflow for this generation if we haven't yet.
  let synthInfo = null;
  if (allowSynth && process.env.EVOYIELD_PUBLIC_URL) {
    const skill = getActiveSkill();
    if (skill) {
      try {
        synthInfo = await synthesiseWorkflow({ skill, agent: agentName });
        if (synthInfo.skipped) {
          console.warn(`\n⚠️  Auto-synth skipped (${synthInfo.mode} mode): ${synthInfo.reason}`);
        } else {
          console.log(
            synthInfo.reused
              ? `\n♻️  Workflow already deployed for gen-${skill.generation}: ${synthInfo.workflowId}`
              : `\n🛠  Synthesised new workflow ${synthInfo.workflowId} for gen-${skill.generation}`,
          );
        }
      } catch (err) {
        console.warn(`[cycle] auto-synth skipped: ${err.message ?? err}`);
      }
    }
  }

  // 5. Trigger the active workflow with the fresh allocation. If we have a
  //    synthesised workflow id we use that; otherwise fall back to the
  //    legacy KH_REBALANCE_WORKFLOW_ID env var (manual setup).
  const reg     = await snapshot();
  const envWorkflowId = (process.env.KH_REBALANCE_WORKFLOW_ID ?? "").trim() || null;
  const overrideId = synthInfo?.workflowId ?? reg.current?.workflowId ?? envWorkflowId;
  if (overrideId) {
    console.log(`\n🚀 Triggering KeeperHub workflow ${overrideId}...`);
  }

  let khResult;
  try {
    khResult = await triggerRebalance({
      allocation:   result.allocation,
      marketData,
      generation:   result.generation,
      fitnessScore: result.fitnessScore,
      workflowId:   overrideId,
    });
    if (!khResult?.triggered && allowSynth && /(permission|forbidden|disabled)/i.test(khResult?.error ?? "")) {
      const skill = getActiveSkill();
      if (skill) {
        console.warn("\n⚠️  Current KeeperHub workflow is not runnable; creating an owned enabled workflow...");
        const forced = await synthesiseWorkflow({
          skill,
          agent: agentName,
          force: true,
          cleanupRetired: false,
        });
        if (forced.skipped) {
          console.warn(`\n⚠️  Could not auto-create KeeperHub workflow: ${forced.reason}`);
        } else {
          console.log(`\n🛠  Created owned KeeperHub workflow ${forced.workflowId}; retrying trigger...`);
          synthInfo = forced;
          khResult = await triggerRebalance({
            allocation:   result.allocation,
            marketData,
            generation:   result.generation,
            fitnessScore: result.fitnessScore,
            workflowId:   forced.workflowId,
          });
        }
      }
    }
    if (!khResult?.triggered) {
      console.warn(`\n⚠️  KeeperHub trigger did not run: ${khResult?.error ?? "unknown reason"}`);
    }
  } catch (err) {
    if (err instanceof KeeperHubError && err.status === 410) {
      const workflowId = overrideId ?? process.env.KH_REBALANCE_WORKFLOW_ID ?? null;
      const detail = err.body?.error ?? "Workflow is disabled";
      console.warn(
        `\n⚠️  KeeperHub workflow is disabled (${workflowId ?? "unknown"}). ` +
        `Enable/Publish it in KeeperHub and re-run. (${detail})`,
      );
      khResult = {
        triggered: false,
        workflowId,
        error: detail,
        disabled: true,
      };
    } else {
      throw err;
    }
  }

  // 6. Notify
  const message = formatCycleMessage(marketData, result, khResult);
  if (message) {
    const out = await sendDiscord(message);
    if (out?.sent)         console.log("\n📲 Discord notification sent.");
    else if (out?.skipped) console.log("\n📲 Discord webhook not configured — skipping.");
  }

  console.log("\n✅ Cycle complete.\n");
  return { marketData, result, khResult, synth: synthInfo };
}
