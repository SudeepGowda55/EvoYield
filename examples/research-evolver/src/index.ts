/**
 * index.ts — Entry point / runner
 *
 * This file wires together:
 *   - config  (from config.ts)
 *   - agent   (ResearchEvolver from agent.ts)
 *   - adapters (0G Compute, 0G Storage, SkillRegistry)
 *   - UI      (terminal output from ui.ts)
 *
 * Run:   npm start  (or: npx ts-node src/index.ts)
 *
 * ── How EvoFrame works ────────────────────────────────────────────────────
 *
 *  1. Agent starts with "genesis skills" — naive implementations
 *  2. You call agent.executeSkill(name, input)
 *  3. If output fails validation → evolution loop fires automatically
 *  4. 0G Compute generates mutation candidates (AI-rewritten implementations)
 *  5. Each candidate is scored by the fitness benchmarks you defined
 *  6. Best candidate above fitnessThreshold wins and is stored on 0G Storage
 *  7. Next call uses the promoted implementation
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

import chalk from "chalk";
import { StorageAdapter, ComputeAdapter } from "@evoframe/0g-adapter";
import { SkillRegistryAdapter } from "@evoframe/skill-registry";
import { config } from "./config.js";
import { ResearchEvolver } from "./agent.js";
import { printHeader, printEvolutionEvent } from "./ui.js";
import {
  BUGGY_CODE_SQL,
  BUGGY_CODE_MISSING_AWAIT,
  BUGGY_CODE_NO_TRY_CATCH,
  BUGGY_CODE_STATEFUL_REGEX,
} from "./benchmarks.js";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  printHeader();

  // ── Adapters ──────────────────────────────────────────────────────────────
  // StorageAdapter: stores evolved skill code on 0G Storage (with lineage)
  // ComputeAdapter: calls 0G Compute (sealed AI inference) for mutations
  // SkillRegistryAdapter: reads/writes on-chain skill registry
  const storage = new StorageAdapter({
    storageRpcUrl: config.storageRpcUrl,
    localMode: process.env["STORAGE_LOCAL"] === "true",
    localCachePath: new URL("../.evoframe-cache.json", import.meta.url).pathname,
  });

  const compute = new ComputeAdapter({
    computeEndpoint: config.computeEndpoint,
    apiKey: process.env["ZG_API_KEY"],
    mode: (process.env["COMPUTE_MODE"] as "live" | "openai" | "local") ?? "local",
  });

  const registry = new SkillRegistryAdapter({
    rpcUrl: config.chainRpcUrl,
    contractAddress: config.skillRegistryAddress,
    privateKey: config.agentPrivateKey,
    localMode: process.env["CHAIN_LOCAL"] === "true",
  });

  // ── Create agent ──────────────────────────────────────────────────────────
  const agent = new ResearchEvolver(config, storage, compute, registry);

  // Subscribe to every evolution event for live terminal output
  agent.getEngine().on(printEvolutionEvent);

  await agent.initialize();
  console.log(
    chalk.gray("  Agent initialized. Skills loaded from 0G Storage (or genesis defaults).\n"),
  );

  // ==========================================================================
  // Phase 1 — Code review with genesis (naive) implementation
  // Three real buggy JS snippets — the naive skill will mostly miss them
  // ==========================================================================

  console.log(chalk.bold("\n━━━━━━ Phase 1: Code reviewer — genesis (naive) skill ━━━━━━\n"));

  const tasks = [
    { label: "SQL injection", code: BUGGY_CODE_SQL },
    { label: "Missing await", code: BUGGY_CODE_MISSING_AWAIT },
    { label: "No try-catch", code: BUGGY_CODE_NO_TRY_CATCH },
    { label: "Stateful regex /g bug", code: BUGGY_CODE_STATEFUL_REGEX },
  ];

  for (const task of tasks) {
    console.log(chalk.yellow(`\n  Testing: ${task.label}`));
    const review = await agent.run({
      id: `phase1-${Date.now()}`,
      description: "Review code for bugs",
      input: { code: task.code },
      domain: "coding",
    });
    const o = review.output as { score?: number; issueCount?: number; issues?: unknown[] };
    console.log(
      chalk.cyan("  Result:"),
      `score=${o?.score ?? "?"}, issues=${o?.issueCount ?? o?.issues?.length ?? "?"}`,
    );
  }

  // ==========================================================================
  // Phase 2 — Evolve code-reviewer via 0G Compute
  // (skipped if already evolved from a previous run)
  // ==========================================================================

  const currentSkill = agent.listSkills().find((s) => s.name === "code-reviewer");
  const alreadyEvolved = currentSkill && currentSkill.generation > 0;

  if (alreadyEvolved) {
    console.log(
      chalk.bold("\n━━━━━━ Phase 2: code-reviewer already evolved (loaded from cache) ━━━━━━\n"),
    );
    console.log(
      chalk.green(
        `  ✓ Using gen-${currentSkill.generation} implementation (fitness=${currentSkill.fitnessScore})`,
      ),
    );
    console.log(
      chalk.gray(
        "  Skipping 0G Compute call — delete .evoframe-cache.json to force re-evolution.\n",
      ),
    );
  } else {
    console.log(chalk.bold("\n━━━━━━ Phase 2: Evolving code-reviewer via 0G Compute ━━━━━━\n"));

    await agent.forceEvolve(
      "code-reviewer",
      "Genesis only detects console.log — misses SQL injection, missing await, and stateful regex /g flag bug",
      "Return { issues: Array<{ type:string, severity:string, message:string, fix:string }>, score:number, issueCount:number, summary:string }",
    );
  }

  console.log(chalk.green.bold("\n  Re-running with evolved skill:\n"));
  for (const task of tasks) {
    const review = await agent.run({
      id: `phase2-${Date.now()}`,
      description: "Review code for bugs",
      input: { code: task.code },
      domain: "coding",
    });
    const o = review.output as Record<string, unknown>;
    const score = (o?.["score"] ?? o?.["qualityScore"] ?? o?.["codeScore"] ?? "?") as
      | string
      | number;
    const issues = (o?.["issues"] ?? o?.["problems"] ?? o?.["findings"] ?? []) as Array<
      Record<string, unknown>
    >;
    const issueLabels = issues
      .slice(0, 2)
      .map((i) =>
        String(i["message"] ?? i["description"] ?? i["type"] ?? i["name"] ?? JSON.stringify(i)),
      );
    console.log(
      chalk.cyan(`  ${task.label}:`),
      `score=${score}  issues=[${issueLabels.join(" | ")}]`,
    );
  }

  // ==========================================================================
  // Phase 3 — Your code: the stateful regex /g bug
  //
  // The evolved skill should now detect:
  //   const EMAIL_REGEX = /regex/g  ← using /g with .test() in a filter is broken
  //   Because .test() advances lastIndex, alternating items get silently dropped
  // ==========================================================================

  console.log(chalk.bold("\n━━━━━━ Phase 3: Your code — stateful regex /g bug ━━━━━━\n"));
  console.log(chalk.gray("  Code under test:"));
  console.log(
    chalk.gray("  const EMAIL_REGEX = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/g  ← the /g flag is the bug"),
  );
  console.log(
    chalk.gray(
      '  filterValidEmails([...]) silently drops "bob" because regex lastIndex advances\n',
    ),
  );

  const regexReview = await agent.run({
    id: `phase3-${Date.now()}`,
    description: "Review code for bugs",
    input: { code: BUGGY_CODE_STATEFUL_REGEX },
    domain: "coding",
  });
  const ro = regexReview.output as Record<string, unknown>;
  const rScore = (ro?.["score"] ?? ro?.["qualityScore"] ?? "?") as string | number;
  const rIssues = (ro?.["issues"] ?? ro?.["problems"] ?? ro?.["findings"] ?? []) as Array<
    Record<string, unknown>
  >;

  if (rIssues.length === 0) {
    console.log(
      chalk.red("  ✗ Evolved skill did NOT detect the /g flag bug (score=" + rScore + ")"),
    );
    console.log(chalk.yellow("  The bug: regex with /g flag used with .test() is stateful."));
    console.log(chalk.yellow("  Fix: remove the g flag → /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/"));
  } else {
    console.log(chalk.green.bold("  ✓ Bug FOUND by evolved skill! (score=" + rScore + ")"));
    for (const issue of rIssues) {
      const msg = String(
        issue["message"] ?? issue["description"] ?? issue["type"] ?? JSON.stringify(issue),
      );
      const fix = String(issue["fix"] ?? issue["suggestion"] ?? "");
      console.log(chalk.cyan("    Issue:"), msg);
      if (fix) console.log(chalk.gray("    Fix:  "), fix);
    }
  }

  // ==========================================================================
  // Final summary
  // ==========================================================================

  console.log(
    chalk.bold.green(`
╔══════════════════════════════════════════════════════════╗
║              Evolution complete!                         ║
╚══════════════════════════════════════════════════════════╝`),
  );

  const allSkills = agent.listSkills();
  for (const skill of allSkills) {
    const evolved =
      skill.generation > 0
        ? chalk.green(`gen-${skill.generation} (evolved)`)
        : chalk.gray("gen-0 (genesis)");
    console.log(`  • ${skill.name.padEnd(22)} ${evolved}   fitness=${skill.fitnessScore ?? "N/A"}`);
  }

  if (process.env["STORAGE_LOCAL"] !== "true") {
    console.log(chalk.gray("\n  Skills stored on 0G Storage with lineage — survives restarts."));
    console.log(chalk.gray("  Next run will load gen-N implementations automatically."));
  }

  console.log();
}

main().catch((err) => {
  console.error(chalk.red.bold("\n[ERROR]"), err);
  process.exit(1);
});
