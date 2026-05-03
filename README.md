# EvoFrame — Self-Evolving Agent Framework on 0G

> ETHGlobal Open Agents 2026 · **0G Track — Best Agent Framework, Tooling & Core Extensions**

EvoFrame is a framework where **skills are living artifacts** — not hardcoded at build time, but autonomously evolved at runtime. When an agent underperforms, EvoFrame triggers a mutation cycle via **0G Compute**, evaluates candidates in a sandboxed fitness runner, promotes the winner, and persists the full genetic lineage to **0G Storage**. Every promoted skill is registered on **0G Chain**. Skills spread across agents via **cross-agent pollination over 0G DA**.

---

## Submission Snapshot

**Project:** EvoFrame — Self-Evolving Agent Framework on 0G

**Description:** Agents package their behaviour as `SkillGenome` artifacts, use 0G Compute to generate improved mutations, benchmark candidates locally, persist lineage to 0G Storage, and register promoted skills on 0G Chain. EvoYield is the live DeFi example agent built with the framework.

**Repository:** [github.com/SudeepGowda55/EvoYield](https://github.com/SudeepGowda55/EvoYield)

**Live demo:** [evoyield.vercel.app](https://evoyield.vercel.app) — 60.1 USDC pool · 24 KeeperHub rebalances · +12.10 pts estimated APY lift

**Backend API:** `https://utc-dialogue-opposed-wanting.trycloudflare.com`

**Working example agent:** [`agents/evoyield`](agents/evoyield) — evolves a DeFi yield-allocation strategy and triggers KeeperHub to rebalance a Sepolia USDC vault pool.

**0G Galileo contracts:**

| Contract | Address |
|---|---|
| SkillRegistry | [`0x3fE1dcaf1126c62f21FD28fF030D5D8B0e1f17d1`](https://chainscan-galileo.0g.ai/address/0x3fe1dcaf1126c62f21fd28ff030d5d8b0e1f17d1) |
| SkillToken | [`0x2A22B21b15d6305AbCbe78ff3098aed2F5B54869`](https://chainscan-galileo.0g.ai/address/0x2A22B21b15d6305AbCbe78ff3098aed2F5B54869) |

**Sepolia contracts:**

| Contract | Address |
|---|---|
| EvoYieldRebalancer | [`0xcaD4CE47becA13D10F885E0e78714c21FD6c1165`](https://sepolia.etherscan.io/address/0xcaD4CE47becA13D10F885E0e78714c21FD6c1165) |
| Aave mock vault | [`0x02b5e71D8C0D1e0C76EF66A7bA6bB58201363BB3`](https://sepolia.etherscan.io/address/0x02b5e71D8C0D1e0C76EF66A7bA6bB58201363BB3) |
| Morpho mock vault | [`0x0e2bb0C5802A1dDd4D56AB89bfC7f20732D91B5c`](https://sepolia.etherscan.io/address/0x0e2bb0C5802A1dDd4D56AB89bfC7f20732D91B5c) |
| Yearn mock vault | [`0x24BF9F1c089b0374e3bDFA0Ed3c6D6C815D9C816`](https://sepolia.etherscan.io/address/0x24BF9F1c089b0374e3bDFA0Ed3c6D6C815D9C816) |
| Sky mock vault | [`0xc0468ee91158e409814de57a7918217B30589a70`](https://sepolia.etherscan.io/address/0xc0468ee91158e409814de57a7918217B30589a70) |

---

## The Problem

Every existing agent framework — OpenClaw, LangGraph, CrewAI, ElizaOS — is **static**. Skills are written by developers, deployed once, and never improve without manual intervention. This is the fundamental bottleneck for long-running autonomous agents operating in dynamic environments.

## The Solution

EvoFrame treats each agent skill as a **SkillGenome**: a versioned, fitness-scored, lineage-tracked unit of executable logic stored on 0G Storage. The evolution loop runs entirely on decentralised infrastructure:

```
Underperformance detected
        ↓
0G Compute generates mutation candidates
        ↓
FitnessRunner evaluates each candidate in a sandboxed VM
        ↓
Best candidate promoted — lineage appended to 0G Storage Log
        ↓
Skill registered on SkillRegistry.sol on 0G Chain
        ↓
Other agents inherit top skills at startup via 0G DA broadcast
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         EvoFrame Agent                           │
│                                                                  │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────────┐  │
│  │  EvoAgent   │───▶│  EvolutionEngine │───▶│  FitnessRunner │  │
│  │  (base cls) │    │  (orchestrator)  │    │  (vm sandbox)  │  │
│  └──────┬──────┘    └────────┬─────────┘    └────────────────┘  │
│         │                   │                                    │
└─────────┼───────────────────┼────────────────────────────────────┘
          │                   │
          ▼                   ▼
┌──────────────────┐  ┌───────────────────────────────────────────┐
│  0G Storage KV   │  │          0G Compute Network               │
│  (SkillGenomes)  │  │  qwen/qwen-2.5-7b-instruct                │
│  0G Storage Log  │  │  Generates mutation candidates            │
│  (lineage chain) │  └───────────────────────────────────────────┘
└──────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────┐
│                      0G Chain (EVM)                              │
│                                                                  │
│  SkillRegistry.sol            SkillToken.sol (SKILL)             │
│  ├── registerSkill()          ├── mint() on import               │
│  ├── getTopSkills(domain)     └── ERC-20 rewards                 │
│  └── getLineage(skillId)                                         │
└──────────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────┐
│              Cross-Agent Pollination (0G DA)                     │
│  Agent A promotes skill → broadcast manifest → Agent B inherits  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 0G Protocol Features Used

| Component | Usage |
|---|---|
| **0G Storage KV** | Stores every `SkillGenome` version with versioned keys — rootHash returned and indexed for retrieval |
| **0G Storage Log** | Append-only lineage history — each promotion appends a `lineage:<id>:<ts>` entry, forming an immutable parent→child chain |
| **0G Compute Network** | `ComputeAdapter` calls `qwen/qwen-2.5-7b-instruct` to generate mutated skill code during each evolution cycle |
| **0G Chain** | `SkillRegistry.sol` records every promoted skill on-chain. The chain is the authoritative rootHash index — `StorageAdapter` queries it as fallback when the local cache misses |
| **0G DA** | `DAAdapter` broadcasts a skill discovery manifest so other EvoFrame agents can inherit top-performing skills at startup |

---

## Monorepo Structure

```
open-agents/
├── packages/
│   ├── core/               # @evoframe/core — EvoAgent base, EvolutionEngine, FitnessRunner
│   ├── 0g-adapter/         # @evoframe/0g-adapter — StorageAdapter, ComputeAdapter, DAAdapter
│   ├── skill-registry/     # @evoframe/skill-registry — SkillRegistryAdapter, on-chain queries
│   └── cli/                # @evoframe/cli — `evo` developer CLI
├── contracts/
│   ├── SkillRegistry.sol           # On-chain skill registry + lineage + SKILL rewards
│   ├── SkillToken.sol              # SKILL ERC-20 token
│   └── EvoYieldSepoliaMocks.sol    # Remix-deployable mock vaults + rebalancer
├── agents/
│   └── evoyield/           # Live DeFi agent built on EvoFrame
├── apps/
│   └── dashboard/          # Next.js dashboard — served from 0G Storage
└── examples/
    └── research-evolver/   # Minimal example: agent that evolves a research skill
```

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/SudeepGowda55/EvoYield
cd EvoYield
npm install
npm run build
```

### 2. Run EvoYield (local mode — no keys needed)

```bash
cd agents/evoyield
cp .env.example .env
node agent.mjs
```

Expected output:
```
✅ Agent ready — gen-11, fitness=100
🤖 Yearn: 3.69%  Aave: 3.43%  Morpho: 3.39%  Sky: 0%
   → Yearn 50%  Aave 30%  Morpho 15%  Sky 5%
```

### 3. Run a full KeeperHub cycle

```bash
node keeperhub.mjs
```

Fetches live APYs → evolved allocation → triggers KeeperHub → executes Sepolia rebalance → uploads dashboard data to 0G Storage.

### 4. Start the HTTP server (with scheduled cycles)

```bash
node server.mjs
```

Starts on `http://localhost:3001`. Runs a KeeperHub cycle every 6 hours automatically.

### 5. Dashboard

```bash
cd apps/dashboard && npm install && npm run dev
```

Set the Vercel project root to `apps/dashboard` for deployment. Live at [evoyield.vercel.app](https://evoyield.vercel.app).

---

## Building Your Own EvoFrame Agent

```typescript
import { EvoAgent, SkillGenome } from "@evoframe/core";
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
        `const rows = input.data;
         const avg = rows.reduce((s, r) => s + r.value, 0) / rows.length;
         return { average: avg, count: rows.length };`
      ),
    ];
  }

  protected defineBenchmarksForSkill(): FitnessTask[] {
    return [
      {
        id: "basic-analysis",
        input: { data: [{ value: 10 }, { value: 20 }, { value: 30 }] },
        validate: (o) => o?.average === 20 && o?.count === 3 ? 100 : 0,
      },
    ];
  }
}

const agent = new MyAgent(
  config,
  new StorageAdapter({ storageRpcUrl: process.env.ZG_STORAGE_RPC }),
  new ComputeAdapter({ computeEndpoint: process.env.COMPUTE_ENDPOINT, apiKey: process.env.ZG_API_KEY }),
  new SkillRegistryAdapter({ contractAddress: process.env.SKILL_REGISTRY_ADDRESS })
);

await agent.initialize();
const result = await agent.run({ id: "t1", description: "Analyze data", input: { data: [...] } });
```

---

## CLI Reference

```bash
evo init [name]          # Scaffold a new agent project
evo deploy               # Deploy SkillRegistry + SkillToken to 0G Chain
evo skills list          # List all active skills
evo skills top <domain>  # Top skills by fitness score in a domain
```

---

## SkillGenome Schema

```typescript
interface SkillGenome {
  id: string;                          // UUID
  name: string;                        // e.g. "yield-allocator"
  domain: SkillDomain;                 // "defi" | "research" | "coding" | ...
  version: string;                     // "12.0.0" — bumped on each promotion
  implementation: string;              // Executable JS function body
  parentId: string | null;             // Lineage link to parent genome
  generation: number;                  // 0 = genesis, 1+ = evolved
  fitnessScore: number;                // 0–100 composite benchmark score
  sealedInferenceAttestation: string;  // 0G Compute attestation ID
  storageKey: string;                  // 0G Storage KV key
  onChainTxHash: string | null;        // 0G Chain registration tx hash
}
```

---

## Team

| Name | Telegram | X |
|---|---|---|
| Sudeep Gowda | [@sudeepgowda55](https://t.me/sudeepgowda55) | [@SudeepdGowda](https://x.com/SudeepdGowda) |
| Vishruth VS | — | [@SVishruth](https://x.com/SVishruth) |
| Manvith Y Shetty | — | [@Manvith68551707](https://x.com/Manvith68551707) |

---

## License

MIT
