# EvoYield — Self-Evolving DeFi Agent on 0G + KeeperHub

> ETHGlobal Open Agents 2026 · **KeeperHub Track** · **0G Track — Best Agent Framework** · **KeeperHub Builder Feedback Bounty**

EvoYield is a self-evolving DeFi yield optimizer built on **EvoFrame** — an open-source agent framework where strategy code is not written by developers but autonomously evolved at runtime. When an agent underperforms, EvoFrame mutates its strategy code using **0G Compute**, benchmarks candidates in a sandboxed VM, promotes the winner to **0G Storage + Chain**, and automatically synthesises a brand new **KeeperHub workflow** to execute the updated strategy on-chain. KeeperHub is not just a consumer — it calls back to the agent when performance degrades, closing the loop entirely. The entire cycle — evolve, deploy workflow, patch, trigger, feedback — runs without any human intervention.

---

## Submission Snapshot

**Project:** EvoYield — Self-Evolving DeFi Agent on 0G + KeeperHub

**Repository:** [github.com/SudeepGowda55/EvoYield](https://github.com/SudeepGowda55/EvoYield)

**Live dashboard:** [evoyield.vercel.app](https://evoyield.vercel.app) — 60.1 USDC pool · 24 KeeperHub rebalances · +12.10 pts estimated APY lift

**Backend API:** `https://utc-dialogue-opposed-wanting.trycloudflare.com`

**Agent source:** [`agents/evoyield/src/agent`](https://github.com/SudeepGowda55/EvoYield/tree/main/agents/evoyield/src/agent) — full implementation of the evolution loop, 0G adapter calls, KeeperHub workflow synthesis, and bidirectional feedback.

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

Every existing agent framework — OpenClaw, LangGraph, CrewAI, ElizaOS — is **static**. Skills are written by developers, deployed once, and never improve without manual intervention. Automation platforms like KeeperHub are powerful executors, but they run workflows that humans designed — they don't adapt when market conditions change or when the strategy stops performing.

EvoFrame solves both sides at once: the agent autonomously evolves its strategy using 0G Compute, and KeeperHub executes the result on-chain — with the workflow itself auto-generated and deployed after every evolution cycle. When KeeperHub detects underperformance, it calls the agent's `/regenerate` endpoint directly, triggering a new evolution. Neither side is passive.

---

## The Full Loop

```
Underperformance detected (fitness < 75)
              ↓
0G Compute generates mutation candidates
              ↓
FitnessRunner evaluates each in a sandboxed VM
              ↓
Best candidate promoted → stored on 0G Storage → registered on 0G Chain
              ↓
KeeperHub workflow auto-synthesised for the new generation
              ↓
BPS values live-patched → KeeperHub triggered → on-chain rebalance executed
              ↓
KeeperHub calls POST /regenerate if performance degrades → loop repeats
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          EvoFrame Agent                              │
│                                                                      │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────────────┐  │
│  │  EvoAgent   │───▶│  EvolutionEngine │───▶│   FitnessRunner    │  │
│  │  (base cls) │    │  (orchestrator)  │    │   (vm sandbox)     │  │
│  └──────┬──────┘    └────────┬─────────┘    └────────────────────┘  │
│         │                   │                                        │
└─────────┼───────────────────┼────────────────────────────────────────┘
          │                   │
          ▼                   ▼
┌──────────────────┐  ┌───────────────────────────────────────────────┐
│  0G Storage KV   │  │           0G Compute Network                  │
│  (SkillGenomes)  │  │   qwen/qwen-2.5-7b-instruct                   │
│  0G Storage Log  │  │   Generates mutation candidates               │
│  (lineage chain) │  └───────────────────────────────────────────────┘
└──────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       0G Chain (EVM)                                 │
│  SkillRegistry.sol — on-chain skill provenance + SKILL token rewards │
└──────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         KeeperHub                                    │
│                                                                      │
│  synthesiseWorkflow()  → AI generates workflow for new generation    │
│  triggerRebalance()    → live-patches BPS values → webhook trigger   │
│  POST /regenerate      ← KeeperHub calls back on low fitness         │
│  checkAndExecute()     → polls execution → records tx hash           │
└──────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Sepolia — EvoYieldRebalancer.sol + Aave / Morpho / Yearn / Sky      │
└──────────────────────────────────────────────────────────────────────┘
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

## KeeperHub Integration

EvoYield has one of the deepest possible KeeperHub integrations — going far beyond calling a webhook. Most KeeperHub integrations are one-directional: agent → webhook → execute. EvoYield's is fully bidirectional and self-managing.

| Feature | Description |
|---|---|
| **Workflow auto-synthesis** | After every evolution, `synthesiseWorkflow()` calls KeeperHub's AI generator with a structured prompt describing the new generation — strategy targets, contract addresses, fitness score — and deploys the returned workflow definition live |
| **Live BPS patching** | Before every trigger, `triggerRebalance()` fetches the current workflow, patches the contract call parameters (BPS values) in the workflow nodes to match the exact evolved allocation, then fires the webhook |
| **Bidirectional feedback loop** | The synthesised workflow calls `GET /status` on the agent before executing. If `fitnessScore < 75`, it calls `POST /regenerate` — KeeperHub drives evolution, not just executes it |
| **Cycle-side safety net** | After every KeeperHub run, `cycle.mjs` independently checks fitness and execution result. If either fails threshold, it calls `forceRegenerate()` and re-synthesises a new workflow for the promoted generation |
| **Full audit trail** | `checkAndExecute.mjs` polls until completion and records every KeeperHub execution ID + Sepolia tx hash in the dashboard — every rebalance is traceable end-to-end |
| **Live numbers** | Workflow `6u8xvdzjhvnbzlu7jw74s` — 24 on-chain rebalances · +12.10 pts estimated APY lift · all visible at [evoyield.vercel.app](https://evoyield.vercel.app) |

> Detailed KeeperHub integration notes, reproducible bugs found during development, and feature requests are documented in [KEEPERHUB_FEEDBACK.md](KEEPERHUB_FEEDBACK.md) — submitted for the KeeperHub Builder Feedback Bounty.

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
│   └── evoyield/           # Live DeFi agent — see agents/evoyield/README.md
├── apps/
│   └── dashboard/          # Next.js dashboard — data fetched from 0G Storage
├── KEEPERHUB_FEEDBACK.md   # KeeperHub Builder Feedback Bounty submission
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

Fetches live APYs → runs evolved strategy → triggers KeeperHub → executes Sepolia rebalance → uploads dashboard data to 0G Storage.

### 4. Start the HTTP server (scheduled cycles every 6h)

```bash
node server.mjs
```

Exposes `POST /evaluate`, `POST /regenerate`, `GET /status`, `GET /dashboard`, `GET /health` on port 3001.

### 5. Dashboard

```bash
cd apps/dashboard && npm install && npm run dev
```

Set Vercel project root to `apps/dashboard` for deployment. Live at [evoyield.vercel.app](https://evoyield.vercel.app).

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

## Links

- Live dashboard: [evoyield.vercel.app](https://evoyield.vercel.app)
- GitHub: [github.com/SudeepGowda55/EvoYield](https://github.com/SudeepGowda55/EvoYield)
- KeeperHub feedback: [KEEPERHUB_FEEDBACK.md](KEEPERHUB_FEEDBACK.md)
- 0G Network: [0g.ai](https://0g.ai)
- KeeperHub: [keeperhub.com](https://keeperhub.com)

---

## License

MIT
