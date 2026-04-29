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
        console.log(
          synthInfo.reused
            ? `\n♻️  Workflow already deployed for gen-${skill.generation}: ${synthInfo.workflowId}`
            : `\n🛠  Synthesised new workflow ${synthInfo.workflowId} for gen-${skill.generation}`,
        );
      } catch (err) {
        console.warn(`[cycle] auto-synth skipped: ${err.message ?? err}`);
      }
    }
  }

  // 5. Trigger the active workflow with the fresh allocation. If we have a
  //    synthesised workflow id we use that; otherwise fall back to the
  //    legacy KH_REBALANCE_WORKFLOW_ID env var (manual setup).
  const reg     = await snapshot();
  const overrideId = synthInfo?.workflowId ?? reg.current?.workflowId;

  const khResult = await triggerRebalance({
    allocation:   result.allocation,
    marketData,
    generation:   result.generation,
    fitnessScore: result.fitnessScore,
    workflowId:   overrideId,
  });

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
