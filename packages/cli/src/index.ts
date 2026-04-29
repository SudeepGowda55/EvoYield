/**
 * @evoframe/cli — evo CLI
 *
 * Commands:
 *   evo init                  — scaffold a new EvoFrame agent project
 *   evo deploy                — deploy contracts to 0G Chain
 *   evo agent run <file>      — run an agent from a TypeScript file
 *   evo skills list           — list all active skills in 0G Storage
 *   evo skills lineage <id>   — show lineage tree for a skill
 *   evo skills top <domain>   — show top skills by domain
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const program = new Command();

program.name("evo").description("EvoFrame — Self-Evolving Agent Framework CLI").version("0.1.0");

// ---------------------------------------------------------------------------
// evo init
// ---------------------------------------------------------------------------

program
  .command("init [name]")
  .description("Scaffold a new EvoFrame agent project")
  .action(async (name?: string) => {
    const projectName = name ?? "my-evo-agent";
    const dir = resolve(process.cwd(), projectName);

    if (existsSync(dir)) {
      console.error(chalk.red(`Directory "${projectName}" already exists.`));
      process.exit(1);
    }

    const spinner = ora(`Scaffolding ${chalk.cyan(projectName)}...`).start();

    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });

    // package.json
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: projectName,
          version: "0.1.0",
          type: "module",
          scripts: { start: "tsx src/agent.ts" },
          dependencies: {
            "@evoframe/core": "^0.1.0",
            "@evoframe/0g-adapter": "^0.1.0",
            "@evoframe/skill-registry": "^0.1.0",
          },
          devDependencies: { tsx: "^4.0.0", typescript: "^5.5.0" },
        },
        null,
        2,
      ),
    );

    // .env template
    writeFileSync(
      join(dir, ".env.example"),
      [
        "AGENT_PRIVATE_KEY=0x...",
        "SKILL_REGISTRY_ADDRESS=0x...",
        "CHAIN_RPC_URL=https://evmrpc-testnet.0g.ai",
        "STORAGE_RPC_URL=https://indexer-storage-testnet-standard.0g.ai",
        "DA_RPC_URL=https://da-node-testnet.0g.ai",
        "COMPUTE_ENDPOINT=https://api.0g.ai",
        "OPENAI_API_KEY=sk-...",
        "COMPUTE_MODE=openai",
      ].join("\n"),
    );

    // Agent scaffold
    writeFileSync(join(dir, "src", "agent.ts"), AGENT_SCAFFOLD_TEMPLATE(projectName));

    spinner.succeed(chalk.green(`Created ${projectName}/`));

    console.log(`
${chalk.bold("Next steps:")}
  ${chalk.cyan("cd")} ${projectName}
  ${chalk.cyan("cp")} .env.example .env  ${chalk.gray("# fill in your keys")}
  ${chalk.cyan("npm install")}
  ${chalk.cyan("npm start")}
`);
  });

// ---------------------------------------------------------------------------
// evo deploy
// ---------------------------------------------------------------------------

program
  .command("deploy")
  .description("Deploy SkillRegistry + SkillToken contracts to 0G Chain")
  .option("--rpc <url>", "0G Chain RPC URL", "https://evmrpc-testnet.0g.ai")
  .option("--key <key>", "Deployer private key (or set AGENT_PRIVATE_KEY env)")
  .action(async (opts: { rpc: string; key?: string }) => {
    const spinner = ora("Deploying contracts to 0G Chain...").start();

    try {
      const privateKey = opts.key ?? process.env["AGENT_PRIVATE_KEY"];
      if (!privateKey) {
        spinner.fail("Missing private key. Use --key or set AGENT_PRIVATE_KEY");
        process.exit(1);
      }

      // Lazy-load viem to avoid startup cost when not deploying
      const { createWalletClient, createPublicClient, http } = await import("viem");
      const { privateKeyToAccount } = await import("viem/accounts");

      const account = privateKeyToAccount(privateKey as `0x${string}`);
      const transport = http(opts.rpc);

      const walletClient = createWalletClient({ account, transport });
      const publicClient = createPublicClient({ transport });

      const { deployContracts } = await import("@evoframe/skill-registry");
      const result = await deployContracts(walletClient, publicClient, account.address);

      spinner.succeed("Contracts deployed!");

      console.log(`
${chalk.bold("Deployment Results:")}
  ${chalk.cyan("SkillRegistry:")} ${result.skillRegistryAddress}
  ${chalk.cyan("SkillToken:")}    ${result.skillTokenAddress}
  
${chalk.gray("Add these to your .env:")}
  SKILL_REGISTRY_ADDRESS=${result.skillRegistryAddress}
`);
    } catch (err) {
      spinner.fail(`Deployment failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// evo skills list
// ---------------------------------------------------------------------------

const skillsCmd = program.command("skills").description("Manage agent skills");

skillsCmd
  .command("list")
  .description("List all active skills from local storage")
  .action(async () => {
    const { StorageAdapter } = await import("@evoframe/0g-adapter");
    const adapter = new StorageAdapter({
      storageRpcUrl: process.env["STORAGE_RPC_URL"] ?? "",
      localMode: true,
    });

    const genomes = await adapter.getAllGenomes();
    const active = genomes.filter((g) => g.status === "active");

    if (active.length === 0) {
      console.log(chalk.yellow("No active skills found."));
      return;
    }

    console.log(chalk.bold(`\n${active.length} active skill(s):\n`));
    for (const g of active.sort((a, b) => b.fitnessScore - a.fitnessScore)) {
      const genLabel =
        g.generation === 0 ? chalk.green("genesis") : chalk.blue(`gen-${g.generation}`);
      console.log(
        `  ${chalk.cyan(g.name.padEnd(30))} ${genLabel.padEnd(12)} fitness=${chalk.yellow(g.fitnessScore)} domain=${g.domain}`,
      );
    }
  });

skillsCmd
  .command("top <domain>")
  .description("Show top skills by domain")
  .option("--limit <n>", "Number of skills to show", "10")
  .action(async (domain: string, opts: { limit: string }) => {
    const { SkillRegistryAdapter } = await import("@evoframe/skill-registry");
    const adapter = new SkillRegistryAdapter({
      contractAddress: process.env["SKILL_REGISTRY_ADDRESS"] ?? "",
      agentAddress: "",
      localMode: true,
    });

    const skills = await adapter.getTopSkills(domain as never, parseInt(opts.limit, 10));

    if (skills.length === 0) {
      console.log(chalk.yellow(`No skills found for domain: ${domain}`));
      return;
    }

    console.log(chalk.bold(`\nTop ${skills.length} skills for "${domain}":\n`));
    for (const s of skills) {
      console.log(
        `  ${chalk.cyan(s.id.slice(0, 8))}...  ${s.name.padEnd(30)}  fitness=${chalk.yellow(s.fitnessScore)}  gen=${s.generation}`,
      );
    }
  });

// ---------------------------------------------------------------------------
// evo agent run
// ---------------------------------------------------------------------------

program
  .command("agent run <file>")
  .description("Run an EvoFrame agent from a TypeScript file")
  .action(async (file: string) => {
    const spinner = ora(`Running agent from ${chalk.cyan(file)}...`).start();
    try {
      const { pathToFileURL } = await import("node:url");
      const agentModule = await import(pathToFileURL(resolve(file)).href);
      if (typeof agentModule.default?.run === "function") {
        spinner.succeed("Agent loaded");
        await agentModule.default.run();
      } else if (typeof agentModule.run === "function") {
        spinner.succeed("Agent loaded");
        await agentModule.run();
      } else {
        spinner.fail("Agent file must export a `run()` function or a default with `.run()`");
      }
    } catch (err) {
      spinner.fail(`Agent run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

// ---------------------------------------------------------------------------
// Agent scaffold template
// ---------------------------------------------------------------------------

function AGENT_SCAFFOLD_TEMPLATE(name: string): string {
  return `/**
 * ${name} — EvoFrame Agent
 * 
 * Edit this file to define your agent's genesis skills and benchmarks.
 */
import { EvoAgent, SkillGenome } from "@evoframe/core";
import { StorageAdapter, ComputeAdapter } from "@evoframe/0g-adapter";
import { SkillRegistryAdapter } from "@evoframe/skill-registry";
import type { FitnessTask } from "@evoframe/core";

const config = {
  agentPrivateKey: process.env.AGENT_PRIVATE_KEY!,
  agentName: "${name}",
  skillRegistryAddress: process.env.SKILL_REGISTRY_ADDRESS!,
  chainRpcUrl: process.env.CHAIN_RPC_URL!,
  storageRpcUrl: process.env.STORAGE_RPC_URL!,
  daRpcUrl: process.env.DA_RPC_URL!,
  computeEndpoint: process.env.COMPUTE_ENDPOINT!,
  evolutionModel: "qwen3.6-plus",
  fitnessThreshold: 70,
  maxCandidatesPerCycle: 3,
};

class MyAgent extends EvoAgent {
  protected defineGenesisSkills(): SkillGenome[] {
    return [
      this.buildGenesis(
        "hello-world",
        "Returns a greeting",
        "general",
        \`return { message: "Hello from " + (input.name ?? "Agent") };\`
      ),
    ];
  }

  protected defineBenchmarksForSkill(skill: SkillGenome): FitnessTask[] {
    return [
      {
        id: "basic-test",
        description: "Skill should return a message",
        input: { name: "World" },
        validate: (output) => {
          const o = output as Record<string, unknown>;
          return o?.message ? 100 : 0;
        },
      },
    ];
  }
}

const storage  = new StorageAdapter({ storageRpcUrl: config.storageRpcUrl, localMode: true });
const compute  = new ComputeAdapter({ mode: (process.env.COMPUTE_MODE as "local" | "openai" | "live") ?? "local", apiKey: process.env.OPENAI_API_KEY });
const registry = new SkillRegistryAdapter({ contractAddress: config.skillRegistryAddress, agentAddress: config.agentName, localMode: true });

const agent = new MyAgent(config, storage, compute, registry);

export async function run() {
  await agent.initialize();
  console.log("Agent initialized with", agent.listSkills().length, "skills");
  
  const result = await agent.run({
    id: "task-1",
    description: "Say hello",
    input: { name: "EvoFrame" },
    domain: "general",
  });
  
  console.log("Result:", result);
}

run().catch(console.error);
`;
}

program.parse(process.argv);
