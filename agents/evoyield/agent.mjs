// Entry point: test the agent with sample market data.
// Usage: node agent.mjs

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const require   = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require("dotenv").config({ path: resolve(__dirname, ".env") });

import { initAgent, evaluate } from "./src/agent/instance.mjs";

await initAgent();

const testCases = [
  { label: "Morpho bull market", data: { aave_apy: 3.2, morpho_apy: 7.8, yearn_apy: 4.1, sky_apy: 2.9 } },
  { label: "Aave leads",         data: { aave_apy: 8.5, morpho_apy: 5.2, yearn_apy: 3.8, sky_apy: 2.1 } },
  { label: "Yearn spike",        data: { aave_apy: 3.0, morpho_apy: 3.5, yearn_apy: 9.2, sky_apy: 2.5 } },
  { label: "Balanced market",    data: { aave_apy: 4.5, morpho_apy: 4.8, yearn_apy: 4.2, sky_apy: 4.1 } },
];

console.log("\n📊 Testing allocation decisions:\n");
for (const { label, data } of testCases) {
  const result = await evaluate(data);
  const { aave, morpho, yearn, sky } = result.allocation ?? {};
  console.log(`${label}:`);
  console.log(`  APYs  → Aave:${data.aave_apy}% | Morpho:${data.morpho_apy}% | Yearn:${data.yearn_apy}% | Sky:${data.sky_apy}%`);
  console.log(`  Alloc → Aave:${aave}% | Morpho:${morpho}% | Yearn:${yearn}% | Sky:${sky}%\n`);
}
