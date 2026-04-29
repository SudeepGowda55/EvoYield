# EvoFrame — Self-Evolving Agent Framework on 0G

> **ETHGlobal Open Agents 2026 · 0G Track — Best Agent Framework, Tooling & Core Extensions**

EvoFrame is the first agent framework where **skills are living artifacts** — not hardcoded at build time, but autonomously evolved at runtime. When an agent fails a task, EvoFrame triggers a mutation cycle via **0G Compute sealed inference**, evaluates candidates in a fitness sandbox, promotes winners, and persists the full genetic lineage to **0G Storage**. Every promoted skill is registered on **0G Chain**. Skills spread across agents via **cross-agent pollination**.

---

## The Problem

Every existing agent framework (OpenClaw, LangGraph, CrewAI, ElizaOS) is **static**. Skills are written by developers, deployed once, and never improve without manual intervention. This is the fundamental bottleneck for long-running autonomous agents.

## The Solution

EvoFrame treats each agent skill as a **SkillGenome**: a versioned, fitness-scored, lineage-tracked unit of executable logic stored on 0G Storage. The evolution loop:

```
Failure detected
    ↓
0G Compute sealed inference generates 3 mutation candidates
    ↓
FitnessRunner evaluates each candidate in a sandboxed vm
    ↓
Best candidate promoted, lineage appended to 0G Storage Log
    ↓
Skill registered on SkillRegistry.sol on 0G Chain
    ↓
Other agents inherit top skills at startup (cross-agent pollination)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        EvoFrame Agent                           │
│                                                                 │
│  ┌─────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  EvoAgent   │───▶│  EvolutionEngine │───▶│ FitnessRunner │  │
│  │  (base cls) │    │  (orchestrator)  │    │  (vm sandbox) │  │
│  └──────┬──────┘    └────────┬─────────┘    └───────────────┘  │
│         │                   │                                   │
└─────────┼───────────────────┼───────────────────────────────────┘
          │                   │
          ▼                   ▼
┌──────────────────┐  ┌──────────────────────────────────────────┐
│  0G Storage KV   │  │           0G Compute Network             │
│  (SkillGenomes)  │  │  qwen3.6-plus / GLM-5-FP8                │
│  0G Storage Log  │  │  Sealed inference → attestation proof    │
│  (lineage chain) │  └──────────────────────────────────────────┘
└──────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│                    0G Chain (EVM)                            │
│                                                              │
│  SkillRegistry.sol          SkillToken.sol (SKILL)           │
│  ├── registerSkill()        ├── mint() on import            │
│  ├── getTopSkills(domain)   └── ERC-20 rewards              │
│  ├── recordImport()                                          │
│  └── getLineage(skillId)                                     │
└──────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────┐
│              Cross-Agent Pollination (0G DA)                 │
│  Agent A's evolved skill → SkillRegistry → Agent B inherits  │
└──────────────────────────────────────────────────────────────┘
```

---

## 0G Protocol Features Used

| Component              | Usage                                                                   |
| ---------------------- | ----------------------------------------------------------------------- |
| **0G Storage KV**      | Stores every `SkillGenome` version with versioned keys                  |
| **0G Storage Log**     | Append-only lineage history — parent→child chain, immutable             |
| **0G Compute Network** | Sealed inference for mutation generation (`qwen3.6-plus`, `GLM-5-FP8`)  |
| **0G Chain**           | `SkillRegistry.sol` — on-chain skill provenance + `SKILL` token economy |
| **0G DA**              | High-throughput messaging for cross-agent skill broadcast               |

---

## Monorepo Structure

```
open-agents/
├── packages/
│   ├── core/               # @evoframe/core — types, EvolutionEngine, FitnessRunner, EvoAgent base
│   ├── 0g-adapter/         # @evoframe/0g-adapter — StorageAdapter, ComputeAdapter
│   ├── skill-registry/     # @evoframe/skill-registry — SkillRegistryAdapter, DeploymentHelper
│   └── cli/                # @evoframe/cli — `evo` developer CLI
├── contracts/
│   ├── SkillRegistry.sol   # On-chain skill registry + lineage + rewards
│   └── SkillToken.sol      # SKILL ERC-20 token
└── examples/
    └── research-evolver/   # Demo: agent that evolves research skills live
```

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/your-handle/open-agents
cd open-agents
npm install
```

### 2. Build all packages

```bash
npm run build
```

### 3. Run the demo agent (local mode — no keys needed)

```bash
cd examples/research-evolver
cp .env.example .env
npm start
```

Expected output:

```
✓ Agent initialized with 3 genesis skills
...
🧬 Evolution triggered for skill 4b193c...
⚗️  Candidate generated (gen 1) via 0G Compute
📊 Fitness score: 93 ✓ PASSES
✅ SKILL PROMOTED! Score=93 Gen=1
   0G Storage hash: fa73a2469e7...
```

### 4. Connect to 0G Galileo Testnet

```bash
# Edit .env with real values:
AGENT_PRIVATE_KEY=0x...
SKILL_REGISTRY_ADDRESS=0x...   # from: evo deploy
COMPUTE_MODE=openai             # or "live" for 0G Compute
OPENAI_API_KEY=sk-...
STORAGE_LOCAL=false
CHAIN_LOCAL=false
```

### 5. Deploy contracts

```bash
npx evo deploy --rpc https://evmrpc-testnet.0g.ai --key 0x...
```

---

## Building Your Own EvoFrame Agent

```typescript
import { EvoAgent, SkillGenome, EvoFrameConfig } from "@evoframe/core";
import { StorageAdapter, ComputeAdapter } from "@evoframe/0g-adapter";
import { SkillRegistryAdapter } from "@evoframe/skill-registry";
import type { FitnessTask } from "@evoframe/core";

class MyAgent extends EvoAgent {
  protected defineGenesisSkills(): SkillGenome[] {
    return [
      this.buildGenesis(
        "data-analyzer",
        "Analyzes structured data and extracts insights",
        "data-analysis",
        `
          const data = input.data as Record<string, number>[];
          const avg = data.reduce((s, r) => s + Object.values(r)[0], 0) / data.length;
          return { average: avg, count: data.length };
        `
      ),
    ];
  }

  protected defineBenchmarksForSkill(skill: SkillGenome): FitnessTask[] {
    return [
      {
        id: "basic-analysis",
        description: "Must return average and count",
        input: { data: [{ value: 10 }, { value: 20 }, { value: 30 }] },
        validate: (output) => {
          const o = output as { average: number; count: number };
          return o?.average === 20 && o?.count === 3 ? 100 : 0;
        },
      },
    ];
  }
}

const config: EvoFrameConfig = { /* see .env.example */ };
const agent = new MyAgent(
  config,
  new StorageAdapter({ storageRpcUrl: process.env.STORAGE_RPC_URL! }),
  new ComputeAdapter({ mode: "openai", apiKey: process.env.OPENAI_API_KEY }),
  new SkillRegistryAdapter({ contractAddress: process.env.SKILL_REGISTRY_ADDRESS!, agentAddress: "my-agent" })
);

await agent.initialize();
const result = await agent.run({ id: "t1", description: "Analyze sales data", input: { data: [...] } });
```

---

## CLI Reference

```bash
evo init [name]          # Scaffold a new agent project
evo deploy               # Deploy contracts to 0G Chain
evo agent run <file>     # Run an agent TypeScript file
evo skills list          # List all active skills
evo skills top <domain>  # Top skills by domain
```

---

## SkillGenome Schema

```typescript
interface SkillGenome {
  id: string; // UUID
  name: string; // "keyword-extractor"
  domain: SkillDomain; // "research" | "coding" | ...
  version: string; // "2.0.0" (bumped on each promotion)
  implementation: string; // executable JS function body
  parentId: string | null; // lineage link
  generation: number; // 0 = genesis, 1+ = evolved
  fitnessScore: number; // 0-100 composite benchmark score
  sealedInferenceAttestation: string | null; // 0G Compute TEE proof
  storageKey: string; // 0G Storage KV key
  onChainTxHash: string | null; // 0G Chain registration tx
}
```

---

## Contract Addresses (0G Galileo Testnet)

| Contract      | Address                          |
| ------------- | -------------------------------- |
| SkillRegistry | `0x...` _(set after deployment)_ |
| SkillToken    | `0x...` _(set after deployment)_ |

---

## Team

| Name        | Telegram | X       |
| ----------- | -------- | ------- |
| _Your name_ | @handle  | @handle |

---

## License

MIT
