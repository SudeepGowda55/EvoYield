# EvoYield

**Self-evolving DeFi yield optimizer powered by EvoFrame (0G Compute + Storage + Chain) + KeeperHub**

> ETHGlobal Open Agents 2026 — **0G Track** ($7,500) · **KeeperHub Track** ($4,500)

**Live dashboard:** [evoyield.vercel.app](https://evoyield.vercel.app) · **Backend API:** `https://utc-dialogue-opposed-wanting.trycloudflare.com` · **Repository:** [github.com/SudeepGowda55/EvoYield](https://github.com/SudeepGowda55/EvoYield)

---

## What is EvoYield?

EvoYield is an autonomous DeFi agent that continuously improves its own yield allocation strategy using evolutionary AI on 0G's decentralised compute network. It doesn't just react to market shifts — it **evolves its own code** to handle them better.

Every 6 hours, EvoYield fetches live APYs from DefiLlama, runs the evolved strategy to compute an optimal allocation, and triggers a KeeperHub workflow to execute real on-chain rebalances across Aave V3, Morpho Blue, Yearn V3, and Sky. If performance degrades, the agent triggers a new evolution cycle via 0G Compute and auto-deploys a fresh KeeperHub workflow for the promoted generation.

| Typical Yield Aggregator | EvoYield |
|---|---|
| Hard-coded rebalancing rules | AI-generated strategy code that evolves over time |
| Same logic forever | Each generation improves through benchmark-driven selection |
| Centralised compute | Runs on 0G's decentralised compute network |
| Manual triggers | Fully automated via KeeperHub — every 6 hours |
| Static workflow | KeeperHub workflow auto-regenerated on every evolution |

**In production:** 60.1 USDC test pool · 24 KeeperHub rebalances · +12.10 pts estimated APY lift across all rebalances.

---

## The Core Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                         EVERY 6 HOURS                           │
│                                                                  │
│  DefiLlama API ──► EvoFrame / 0G Compute                        │
│  (Live APYs)        (evaluates evolved strategy)                │
│                              │                                  │
│              fitnessScore < 75? ──► POST /regenerate            │
│                              │      (0G Compute evolves code)   │
│                              ▼                                  │
│                       KeeperHub ──► Aave V3                     │
│                       (Executes       Morpho Blue               │
│                       on-chain)       Yearn V3                  │
│                              │        Sky / Spark               │
│                              ▼                                  │
│                     0G Storage ──► Dashboard                    │
│                     (audit blob)    (evoyield.vercel.app)       │
└─────────────────────────────────────────────────────────────────┘
```

---

## EvoFrame — How the Strategy Evolves

EvoYield is built on EvoFrame, a self-evolving agent framework. The allocation strategy is a **SkillGenome**: a versioned, fitness-scored, lineage-tracked piece of executable JS code stored on 0G Storage.

### Evolution Lifecycle

```
Genesis Skill (naive 25/25/25/25 equal split)
        │
        ▼
Run 4 benchmark tests
        │
fitness < threshold?
        │
        ▼
0G Compute rewrites the skill code
        │
        ▼
Run benchmarks on the candidate
        │
fitness ≥ 75?  →  Promote: register on 0G Chain, store on 0G Storage
        │
        ▼
KeeperHub workflow auto-synthesised for the new generation
```

### Benchmarks

| Benchmark | Input | Pass Condition |
|---|---|---|
| `morpho-leads-when-highest` | Morpho APY = 7.8% (highest) | `morpho ≥ 40%` |
| `aave-leads-when-highest` | Aave APY = 8.5% (highest) | `aave ≥ 40%` |
| `yearn-leads-when-highest` | Yearn APY = 9.2% (highest) | `yearn ≥ 40%` |
| `allocations-sum-to-100` | Any market | `aave + morpho + yearn + sky == 100` |

Fitness = average score across all benchmarks (0 or 100 each). The agent is currently at **generation 11, fitness 100** — all benchmarks passing.

### What the Evolved Strategy Looks Like

Starting from a naive equal split (gen-0), 0G Compute evolved this allocation logic by generation 1:

```js
// Sort protocols by APY descending
// Assign: rank-1 → 50%, rank-2 → 30%, rank-3 → 15%, rank-4 → 5%
// Handles edge cases: NaN APYs, zero-APY protocols, variable pool sizes
// Total always sums to 100
```

Live example (May 3 2026 — Yearn 3.69%, Aave 3.43%, Morpho 3.39%, Sky 0%):
```
→ Yearn 50%  Aave 30%  Morpho 15%  Sky 5%
```

---

## KeeperHub Integration

EvoYield has one of the deepest possible KeeperHub integrations: the agent does not just *call* KeeperHub — it **auto-generates, deploys, live-patches, and listens back from** KeeperHub workflows at runtime.

### 1. Genome-to-Keeper Auto-Synthesis

Every time EvoFrame promotes a new SkillGenome generation, `synthesiseWorkflow()` automatically:
1. Builds a structured prompt describing the new strategy (generation, fitness, allocation targets, protocol contracts)
2. Calls KeeperHub's `POST /ai/generate-workflow` to produce a full workflow definition
3. Deploys it via `POST /workflows/create`
4. Retires the previous generation's workflow

The agent **writes its own KeeperHub workflows** as a byproduct of evolution — no human intervention.

### 2. Dynamic BPS Auto-Patching

Before triggering, `triggerRebalance()` fetches the current workflow definition, finds the `rebalanceAmountToTargets` contract write node, and updates the BPS arguments in real time to match the evolved allocation:

```
aaveBps   = allocation.aave   × 100   →  e.g. 30% → 3000 BPS
morphoBps = allocation.morpho × 100
yearnBps  = allocation.yearn  × 100
skyBps    = allocation.sky    × 100

PATCH /workflows/{id}  ← update nodes with new BPS values
POST  /workflows/{id}/webhook  ← trigger execution
```

KeeperHub always executes the exact parameters the AI computed — not a stale hardcoded value.

### 3. Bidirectional Performance Feedback Loop

KeeperHub doesn't just receive from EvoYield — it **calls back**:

- The AI-synthesised workflow begins with `GET /status`. If `fitnessScore < 75`, it calls `POST /regenerate` on the agent before executing any rebalance.
- The fallback workflow code node performs the same check in-process via `fetch()`.
- After every execution, `cycle.mjs` checks the KeeperHub result: if the workflow failed or fitness dropped below threshold, it immediately calls `forceRegenerate()` and re-synthesises a new workflow for the evolved generation.

### 4. Execution Monitoring + Audit Trail

`checkAndExecute.mjs` polls KeeperHub execution status until completion. Every execution ID and transaction hash is recorded in the dashboard history:

```json
{
  "executionId": "3zr89c5pnaetaaowkd3c0",
  "transaction": { "hash": "0xd7e97ce7d8fc38e...", "status": "success", "gasUsedUnits": "221552" }
}
```

Full audit trail — every rebalance is traceable from KeeperHub execution ID to Sepolia tx hash, visible at [evoyield.vercel.app](https://evoyield.vercel.app).

### 5. Live Numbers

- **Workflow `6u8xvdzjhvnbzlu7jw74s`** — 24 on-chain rebalances executed
- Pool: 60.1 USDC across Aave V3, Morpho Blue, Yearn V3, Sky on Sepolia
- Estimated APY lift: **+12.10 percentage points** across all rebalances
- Gas per rebalance: ~59k–486k units
- Example tx: [`0xd7e97ce7...`](https://sepolia.etherscan.io/tx/0xd7e97ce7d8fc38e57660b80ed054841f43ae5e86d27d3b47263ce578bc622ab8)

---

## 0G Protocol Usage

| 0G Component | How EvoYield Uses It |
|---|---|
| **0G Compute Network** | `ComputeAdapter` calls `qwen/qwen-2.5-7b-instruct` to generate mutated skill implementations. Called only when the current strategy fails fitness benchmarks. |
| **0G Storage KV** | Every `SkillGenome` (12 generations) is stored as a versioned blob. The rootHash is returned and indexed — chain-authoritative fallback when local cache misses. |
| **0G Storage Log** | Append-only lineage chain: each promotion appends a `lineage:<skillId>:<timestamp>` entry, creating an immutable parent→child history auditable by anyone. |
| **0G Chain** | `SkillRegistry.sol` records every promoted skill on-chain with real tx hashes — e.g. gen-11: [`0xaab0721c...`](https://chainscan-galileo.0g.ai/tx/0xaab0721c03748b3923eeaca054115ca76463520948089e1cfa11a3fea6055510). `StorageAdapter` queries the chain as the authoritative rootHash source. |
| **0G DA** | `DAAdapter` broadcasts a skill discovery manifest after each promotion so other EvoFrame agents can inherit the top-performing skill at startup. |
| **0G Storage (dashboard)** | Latest rebalance data is uploaded as a `dashboard:latest` blob after every cycle. `GET /dashboard` fetches from 0G Storage first — the frontend is fully decoupled from the agent's filesystem. |

---

## HTTP API Reference

### `GET /health`
```json
{ "status": "ok", "service": "EvoYield", "timestamp": "2026-05-03T..." }
```

### `GET /status`
```json
{ "skill": { "name": "yield-allocator", "generation": 11, "fitnessScore": 100 } }
```

### `POST /evaluate`

**Request:**
```json
{ "aave_apy": 3.43, "morpho_apy": 3.39, "yearn_apy": 3.69, "sky_apy": 0 }
```
**Response:**
```json
{ "allocation": { "yearn": 50, "aave": 30, "morpho": 15, "sky": 5 }, "generation": 11, "fitnessScore": 100 }
```

### `POST /regenerate`

Triggers an evolution cycle. Called automatically by KeeperHub when performance degrades.

**Request:**
```json
{ "reason": "KeeperHub detected low fitness (55/100)", "fitnessScore": 55, "generation": 11 }
```
**Response:**
```json
{ "regenerated": true, "generation": 12, "fitnessScore": 100 }
```

### `GET /dashboard`

Returns the latest rebalance run data fetched from 0G Storage (local file fallback). Consumed by [evoyield.vercel.app](https://evoyield.vercel.app) via Next.js rewrite proxy.

---

## Setup

### Prerequisites

- Node.js v22+

### 1. Install

```bash
git clone https://github.com/SudeepGowda55/EvoYield
cd EvoYield
npm install
```

### 2. Configure

```bash
cd agents/evoyield
cp .env.example .env
# Fill in 0G, KeeperHub, Sepolia, and Discord values
```

### 3. Test the agent

```bash
node agent.mjs
```

Runs 4 market scenarios and prints the evolved allocation for each.

### 4. Start the server

```bash
node server.mjs
```

Starts on `http://localhost:3001`. Runs a KeeperHub cycle automatically every 6 hours.

### 5. Run a manual cycle

```bash
node keeperhub.mjs
```

One full cycle: live APYs → evolved allocation → KeeperHub rebalance → 0G Storage dashboard update.

---

## Environment Variables

```env
# ── 0G Network ──────────────────────────────────────────────────
ZG_PRIVATE_KEY=0x...
ZG_CHAIN_RPC=https://evmrpc-testnet.0g.ai
ZG_STORAGE_RPC=https://indexer-storage-testnet-turbo.0g.ai
ZG_API_KEY=...
SKILL_REGISTRY_ADDRESS=0x3fE1dcaf1126c62f21FD28fF030D5D8B0e1f17d1
COMPUTE_ENDPOINT=https://compute-network-6.integratenetwork.work
COMPUTE_MODE=live
EVOLUTION_MODEL=qwen/qwen-2.5-7b-instruct

# ── Server ───────────────────────────────────────────────────────
PORT=3001
EVOYIELD_PUBLIC_URL=https://your-deployed-backend-url.com

# ── KeeperHub ────────────────────────────────────────────────────
KEEPERHUB_API_KEY=kh_...
KH_WEBHOOK_KEY=wfb_...
KH_REBALANCE_WORKFLOW_ID=6u8xvdzjhvnbzlu7jw74s
KH_WEBHOOK_URL=https://app.keeperhub.com/api/workflows/6u8xvdzjhvnbzlu7jw74s/webhook
KH_WAIT_FOR_WORKFLOW=true
KH_WORKFLOW_WAIT_MS=60000

# ── Sepolia Contracts ────────────────────────────────────────────
EVOYIELD_REBALANCER_ADDRESS=0xcaD4CE47becA13D10F885E0e78714c21FD6c1165
EVOYIELD_AAVE_VAULT=0x02b5e71D8C0D1e0C76EF66A7bA6bB58201363BB3
EVOYIELD_MORPHO_VAULT=0x0e2bb0C5802A1dDd4D56AB89bfC7f20732D91B5c
EVOYIELD_YEARN_VAULT=0x24BF9F1c089b0374e3bDFA0Ed3c6D6C815D9C816
EVOYIELD_SKY_VAULT=0xc0468ee91158e409814de57a7918217B30589a70

# ── Notifications ────────────────────────────────────────────────
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js v22, ES modules |
| Agent framework | EvoFrame (`@evoframe/core`, `@evoframe/0g-adapter`, `@evoframe/skill-registry`) |
| AI compute | 0G Compute Network — `qwen/qwen-2.5-7b-instruct` |
| Storage | 0G Storage KV + Log |
| On-chain registry | 0G Chain — `SkillRegistry.sol` |
| APY data | DefiLlama Yields API (free, no auth) |
| Execution automation | KeeperHub workflow webhooks + auto-synthesis |
| HTTP server | Express.js |
| Notifications | Discord Webhook |
| Frontend | Next.js deployed on Vercel |

---

## Contract Addresses

**0G Galileo Testnet:**

| Contract | Address |
|---|---|
| SkillRegistry | [`0x3fE1dcaf1126c62f21FD28fF030D5D8B0e1f17d1`](https://chainscan-galileo.0g.ai/address/0x3fe1dcaf1126c62f21fd28ff030d5d8b0e1f17d1) |
| SkillToken | [`0x2A22B21b15d6305AbCbe78ff3098aed2F5B54869`](https://chainscan-galileo.0g.ai/address/0x2A22B21b15d6305AbCbe78ff3098aed2F5B54869) |

**Ethereum Sepolia:**

| Contract | Address |
|---|---|
| EvoYieldRebalancer | [`0xcaD4CE47becA13D10F885E0e78714c21FD6c1165`](https://sepolia.etherscan.io/address/0xcaD4CE47becA13D10F885E0e78714c21FD6c1165) |
| Aave mock vault | [`0x02b5e71D8C0D1e0C76EF66A7bA6bB58201363BB3`](https://sepolia.etherscan.io/address/0x02b5e71D8C0D1e0C76EF66A7bA6bB58201363BB3) |
| Morpho mock vault | [`0x0e2bb0C5802A1dDd4D56AB89bfC7f20732D91B5c`](https://sepolia.etherscan.io/address/0x0e2bb0C5802A1dDd4D56AB89bfC7f20732D91B5c) |
| Yearn mock vault | [`0x24BF9F1c089b0374e3bDFA0Ed3c6D6C815D9C816`](https://sepolia.etherscan.io/address/0x24BF9F1c089b0374e3bDFA0Ed3c6D6C815D9C816) |
| Sky mock vault | [`0xc0468ee91158e409814de57a7918217B30589a70`](https://sepolia.etherscan.io/address/0xc0468ee91158e409814de57a7918217B30589a70) |

> Sepolia mock vaults are used because Aave/Morpho/Yearn/Sky do not all expose consistent USDC testnet vaults on a single network. The `EvoYieldRebalancer` contract and all four vault contracts are deployed and functional on Sepolia.

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
- 0G Network: [0g.ai](https://0g.ai)
- KeeperHub: [keeperhub.com](https://keeperhub.com)
- ETHGlobal Open Agents 2026: [ethglobal.com/events/agents](https://ethglobal.com/events/agents)

---

## License

MIT
