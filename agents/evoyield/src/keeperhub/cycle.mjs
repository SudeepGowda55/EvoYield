// Full EvoYield cycle:
//   1. Fetch live APY data (DefiLlama)
//   2. Ask evolved agent for allocation (EvoFrame / 0G)
//   3. Trigger KeeperHub rebalance workflow
//   4. Send Telegram notification

import { fetchApyData }                    from "./apy.mjs";
import { triggerRebalance }                from "./rebalance.mjs";
import { sendTelegram, formatCycleMessage } from "./notify.mjs";
import { initAgent, evaluate }             from "../agent/instance.mjs";

export async function runCycle() {
  console.log("\n" + "═".repeat(60));
  console.log(`🔄  EvoYield Cycle   ${new Date().toLocaleTimeString()}`);
  console.log("═".repeat(60));

  // 1. Ensure agent is ready (idempotent — safe to call multiple times)
  await initAgent();

  // 2. Fetch live APY data from DefiLlama
  const marketData = await fetchApyData();

  // 3. Get allocation from the evolved strategy
  console.log("\n🤖 Computing allocation...");
  const result = await evaluate(marketData);

  const { aave, morpho, yearn, sky } = result.allocation ?? {};
  console.log(`   Aave: ${aave}%  |  Morpho: ${morpho}%  |  Yearn: ${yearn}%  |  Sky: ${sky}%`);
  console.log(`   Strategy: gen-${result.generation}, fitness=${result.fitnessScore}`);

  // 4. Trigger KeeperHub rebalance workflow
  const khResult = await triggerRebalance({
    allocation:   result.allocation,
    marketData,
    generation:   result.generation,
    fitnessScore: result.fitnessScore,
  });

  // 5. Notify via Telegram
  const message = formatCycleMessage(marketData, result, khResult);
  await sendTelegram(message);
  if (message) console.log("\n📲 Telegram notification sent.");

  console.log("\n✅ Cycle complete.\n");
  return { marketData, result, khResult };
}
