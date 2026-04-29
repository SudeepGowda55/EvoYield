import { EvoAgent } from "@evoframe/core";
import { benchmarks } from "./benchmarks.mjs";
import { evolveHint } from "./hint.mjs";

export class EvoYieldAgent extends EvoAgent {
  defineGenesisSkills() {
    return [
      this.buildGenesis(
        "yield-allocator",
        "Yield Allocator",
        "defi",
        // Intentionally naive genesis — equal weight. Evolution will improve this.
        `const aave   = Number(input.aave_apy   ?? 0);
const morpho = Number(input.morpho_apy ?? 0);
const yearn  = Number(input.yearn_apy  ?? 0);
const sky    = Number(input.sky_apy    ?? 0);
return { aave: 25, morpho: 25, yearn: 25, sky: 25 };`,
        [
          { name: "aave_apy",   type: "number", required: true },
          { name: "morpho_apy", type: "number", required: true },
          { name: "yearn_apy",  type: "number", required: true },
          { name: "sky_apy",    type: "number", required: true },
        ]
      ),
    ];
  }

  defineBenchmarksForSkill() {
    return benchmarks;
  }

  defineEvolveHint() {
    return evolveHint;
  }
}
