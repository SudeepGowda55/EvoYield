/**
 * ui.ts — Terminal output helpers
 *
 * All the colors, icons, and formatting live here.
 * Nothing in here affects how the framework works — it's purely cosmetic.
 */

import chalk from "chalk";
import type { EvolutionEvent } from "@evoframe/core";

export function printHeader() {
  console.log(
    chalk.bold.cyan(`
╔══════════════════════════════════════════════════════════╗
║             EvoFrame — ResearchEvolver Demo              ║
║        Self-Evolving Agent Framework on 0G               ║
╚══════════════════════════════════════════════════════════╝
`),
  );
}

export function printEvolutionEvent(event: EvolutionEvent) {
  const icons: Record<string, string> = {
    mutation_requested: "🧬",
    candidate_generated: "⚗️ ",
    fitness_evaluation_started: "🔬",
    fitness_evaluation_completed: "📊",
    skill_promoted: "✅",
    skill_rejected: "❌",
    skill_registered_onchain: "⛓️ ",
    pollination_received: "🌱",
  };

  const icon = icons[event.type] ?? "•";
  const skillShort = event.skillId.slice(0, 8);

  switch (event.type) {
    case "mutation_requested":
      console.log(chalk.yellow(`  ${icon} Evolution triggered for skill ${skillShort}...`));
      console.log(chalk.gray(`     Reason: ${event.data["failureReason"]}`));
      break;
    case "candidate_generated":
      console.log(
        chalk.blue(
          `  ${icon} Candidate generated (gen ${event.data["generation"]}) via 0G Compute`,
        ),
      );
      break;
    case "fitness_evaluation_started":
      console.log(chalk.gray(`  ${icon} Running fitness tests on candidate ${skillShort}...`));
      break;
    case "fitness_evaluation_completed": {
      const score = event.data["score"] as number;
      const passed = event.data["passed"] as boolean;
      console.log(
        `  ${icon} Fitness score: ${(passed ? chalk.green : chalk.red)(String(score))} ${passed ? "✓ PASSES" : "✗ REJECTED"}`,
      );
      break;
    }
    case "skill_promoted":
      console.log(
        chalk.green.bold(
          `  ${icon} SKILL PROMOTED! Score=${event.data["fitnessScore"]} Gen=${event.data["generation"]}`,
        ),
      );
      console.log(chalk.gray(`     0G Storage hash: ${event.data["storageHash"]}`));
      break;
    case "skill_rejected":
      console.log(chalk.red(`  ${icon} All candidates rejected (below fitness threshold)`));
      break;
    case "skill_registered_onchain":
      console.log(
        chalk.magenta(
          `  ${icon} Registered on 0G Chain! TX: ${String(event.data["txHash"]).slice(0, 16)}...`,
        ),
      );
      break;
    case "pollination_received":
      console.log(chalk.cyan(`  ${icon} Pollinated skill from agent: ${event.data["from"]}`));
      break;
  }
}
