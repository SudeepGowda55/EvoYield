// Entry point: Genome-to-Keeper auto-synthesis demo.
//
// What this does:
//   1. Boots the EvoYield agent (loading any cached evolved skill).
//   2. Subscribes to the EvolutionEngine's `skill_promoted` event so any
//      future promotion immediately spawns a fresh KeeperHub workflow.
//   3. Synthesises a workflow for the *currently active* skill if none has
//      been registered yet (covers the cold-start case after `npm install`).
//   4. Prints the registry snapshot so you can see the lineage.
//
// Usage:  node genome-to-keeper.mjs
// Env:    EVOYIELD_PUBLIC_URL must be set (ngrok works fine)
//         KEEPERHUB_API_KEY must be set, OR KH_MODE=mock for offline runs.

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const require   = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require("dotenv").config({ path: resolve(__dirname, ".env") });

import { initAgent, getAgent, getActiveSkill } from "./src/agent/instance.mjs";
import { attachAutoSynth, synthesiseWorkflow } from "./src/keeperhub/synth.mjs";
import { snapshot }                            from "./src/keeperhub/registry.mjs";

const AGENT_NAME = "EvoYield-v1";

function banner(title) {
  console.log("\n" + "═".repeat(60));
  console.log(title);
  console.log("═".repeat(60));
}

banner("🧬  Genome-to-Keeper Synthesis Demo");

if (!process.env.EVOYIELD_PUBLIC_URL) {
  console.warn(
    "\n⚠️  EVOYIELD_PUBLIC_URL is not set.\n" +
    "    The synthesised workflow needs a public URL so KeeperHub can call back\n" +
    "    into /evaluate and /regenerate. Run `npx ngrok http 3001` and set\n" +
    "    EVOYIELD_PUBLIC_URL to the ngrok URL in your .env, then re-run.\n",
  );
}

await initAgent();

// 1. Subscribe — any future promotion auto-synthesises its workflow.
attachAutoSynth(getAgent(), { agentName: AGENT_NAME });
console.log("✅ Auto-synth listener attached to EvolutionEngine.");

// 2. Cold-start: if there's no workflow for the current generation, build one now.
const skill = getActiveSkill();
if (skill && process.env.EVOYIELD_PUBLIC_URL) {
  banner(`🛠   Synthesising workflow for ${skill.name} gen-${skill.generation}`);
  try {
    const out = await synthesiseWorkflow({ skill, agent: AGENT_NAME });
    console.log(
      out.reused
        ? `   ↳ already deployed: ${out.workflowId}`
        : `   ↳ deployed:        ${out.workflowId}`,
    );
  } catch (err) {
    console.error(`   ✗ synth failed: ${err.message ?? err}`);
    if (err.body) console.error(`     body: ${JSON.stringify(err.body)}`);
    process.exitCode = 1;
  }
}

// 3. Show what the registry knows now.
banner("📒  KeeperHub registry snapshot");
const snap = await snapshot();
console.log(JSON.stringify(snap, null, 2));

console.log(
  "\nNext steps:\n" +
  "  • Run `node keeperhub.mjs` to trigger one rebalance via the synthesised workflow.\n" +
  "  • Delete .evoframe-cache.json and re-run to watch a new generation auto-synthesise.\n",
);
