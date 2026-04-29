# EvoYield Agent

**Self-evolving DeFi yield optimizer powered by EvoFrame (0G Compute) + KeeperHub**

ETHGlobal Open Agents 2026 — Dual-track submission

- **0G Track** — $7,500 prize pool
- **KeeperHub Track** — $4,500 prize pool

---

## What is EvoYield?

EvoYield is an autonomous DeFi agent that continuously improves its own yield allocation strategy using evolutionary AI on 0G's decentralized compute network. When market APYs shift, EvoYield doesn't just react — it evolves.

### The Core Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                        EVERY CYCLE                              │
│                                                                 │
│  DefiLlama API                                                  │
│  (Live APYs) ──► EvoFrame / 0G ──► Evolved Strategy            │
│                  (AI rewrites &        │                        │
│                   benchmarks code)     ▼                        │
│                                  KeeperHub ──► Aave V3          │
│                                  (Executes)     Morpho Blue     │
│                                     │           Yearn V3        │
│                                     │           Sky / Spark     │
│                                     ▼                           │
│                               Telegram Bot                      │
│                               (Notifies you)                    │
└─────────────────────────────────────────────────────────────────┘
```

### What Makes It Different

| Typical Yield Aggregator     | EvoYield                                          |
| ---------------------------- | ------------------------------------------------- |
| Hard-coded rebalancing rules | AI-generated strategy code that evolves over time |
| Same logic forever           | Each evolution cycle improves the strategy        |
| Centralized compute          | Runs on 0G's decentralized compute network        |
| Manual triggers              | Fully automated via KeeperHub keeper network      |

---

## Architecture

```
open-agents/                          ← Root monorepo (submit this)
├── packages/                         ← EvoFrame framework packages
│   ├── core/                         ← @evoframe/core
│   ├── 0g-adapter/                   ← @evoframe/0g-adapter
│   ├── skill-registry/               ← @evoframe/skill-registry
│   └── cli/                          ← @evoframe/cli
├── agents/
│   └── evoyield/                     ← This agent (you are here)
│       ├── src/
│   ├── agent/
│   │   ├── EvoYieldAgent.mjs   ← Agent class (extends EvoAgent from EvoFrame)
│   │   ├── benchmarks.mjs      ← What "good" means (4 test cases the strategy must pass)
│   │   ├── hint.mjs            ← Instructions fed to 0G AI when evolving
│   │   └── instance.mjs        ← Singleton agent shared across server + cycle
│   ├── server/
│   │   └── app.mjs             ← Express HTTP server (/evaluate, /status, /health)
│   └── keeperhub/
│       ├── client.mjs          ← KeeperHub REST API base client
│       ├── apy.mjs             ← Live APY fetcher from DefiLlama (no API key needed)
│       ├── rebalance.mjs       ← Triggers KeeperHub rebalance workflow via webhook
│       ├── notify.mjs          ← Telegram Bot API notifications
│       └── cycle.mjs           ← Orchestrates the full pipeline
│       ├── agent.mjs                   ← Entry: test the agent with sample scenarios
│       ├── server.mjs                  ← Entry: start the HTTP API server
│       ├── keeperhub.mjs               ← Entry: run one full rebalance cycle
│       ├── .env.example                ← Template for all environment variables
│       └── .evoframe-cache.json        ← Local skill registry cache (auto-generated)
├── examples/
│   └── research-evolver/             ← Example agent
└── contracts/
    ├── SkillRegistry.sol
    └── SkillToken.sol
```

---

## How EvoFrame Works

EvoFrame is the evolutionary AI framework built for this hackathon. It treats agent strategy as **living code** that improves itself.

### Evolution Lifecycle

```
Genesis Skill (naive equal split: 25/25/25/25)
        │
        ▼
   Run Benchmarks
        │
   fitness < threshold (60)?
        │
        ▼
   Ask 0G AI to rewrite the skill (using evolveHint)
        │
        ▼
   Run Benchmarks on new candidate
        │
   fitness >= threshold?
        │
        ▼
   Promote new skill (replace active strategy)
        │
        ▼
   Cache in .evoframe-cache.json (persists across runs)
```

### Benchmarks (what the strategy is tested against)

| Benchmark ID                | Test Input                  | Pass Condition                 |
| --------------------------- | --------------------------- | ------------------------------ |
| `morpho-leads-when-highest` | Morpho APY = 7.8% (highest) | `morpho >= 40%`                |
| `aave-leads-when-highest`   | Aave APY = 8.5% (highest)   | `aave >= 40%`                  |
| `yearn-leads-when-highest`  | Yearn APY = 9.2% (highest)  | `yearn >= 40%`                 |
| `allocations-sum-to-100`    | Balanced market             | `aave+morpho+yearn+sky == 100` |

A candidate must pass all 4 benchmarks (fitness = 100) to be promoted.

### The Evolved Strategy (gen-1, fitness=100)

The 0G AI generated this allocation logic — it's the actual code stored and executed:

```js
// Sort protocols by APY descending
// Assign fixed weights: rank-1 → 50%, rank-2 → 30%, rank-3 → 15%, rank-4 → 5%
// Total always = 100
```

Example outputs with real market data (today, Apr 29 2026):

- Aave 3.97%, Yearn 3.49%, Morpho 3.03%, Sky 0% → `Aave 50%, Yearn 30%, Morpho 15%, Sky 5%`

---

## Live Data Sources

### DefiLlama Yields API

- URL: `https://yields.llama.fi/pools`
- No API key required
- Cached for 5 minutes in-memory
- Picks the highest-TVL pool per protocol for stability

Protocol mappings used:

| Protocol | Project slugs tried         | Token symbols tried |
| -------- | --------------------------- | ------------------- |
| Aave     | `aave-v3`, `aave-v4`        | USDC                |
| Morpho   | `morpho-blue`, `morpho`     | USDC                |
| Yearn    | `yearn-finance`, `yearn-v3` | USDC                |
| Sky      | `sky`, `spark`, `maker-dsr` | USDS, DAI, USDC     |

### KeeperHub Rebalance API

- Base URL: `https://app.keeperhub.com/api`
- Auth: `X-API-Key` header
- Trigger: `POST /workflows/{workflowId}/webhook`
- Payload sent: `{ allocation, marketData, generation, fitnessScore, timestamp }`

### 0G Compute Network

- Endpoint: `https://compute-network-6.integratenetwork.work`
- Model: `qwen/qwen-2.5-7b-instruct`
- Auth: `ZG_API_KEY` in `.env`
- Called only when current strategy fails benchmarks (not on every cycle)

---

## Setup

### Prerequisites

- Node.js v22+
- The `open-agents` monorepo (this repo — EvoFrame packages are in `packages/`)
- A 0G API key

### 1. Install dependencies

From the **monorepo root**:

```bash
cd open-agents
npm install
```

This wires all `@evoframe/*` packages as workspace symlinks — no tarballs needed.

### 2. Configure environment

```bash
cd agents/evoyield
cp .env.example .env
```

Edit `.env` and fill in your values (see [Environment Variables](#environment-variables) section below).

### 3. Run the agent test

```bash
cd agents/evoyield
node agent.mjs
```

This tests 4 market scenarios and prints the evolved allocation for each.

### 4. Start the HTTP server

```bash
cd agents/evoyield
npm start
# or
node server.mjs
```

Server runs on `http://localhost:3001` (configurable via `PORT` in `.env`).

### 5. Run a full KeeperHub cycle

```bash
cd agents/evoyield
node keeperhub.mjs
```

Fetches real APYs → gets evolved allocation → triggers KeeperHub → sends Telegram.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
# ── 0G Compute (YOUR side) ─────────────────────────────────────────
COMPUTE_ENDPOINT=https://compute-network-6.integratenetwork.work
ZG_API_KEY=your-0g-api-key-here          # Get from 0G dashboard
COMPUTE_MODE=live                         # Use "local" to skip 0G calls (offline testing)
EVOLUTION_MODEL=qwen/qwen-2.5-7b-instruct

# ── HTTP Server ─────────────────────────────────────────────────────
PORT=3001

# ── KeeperHub (FRIEND's side) ───────────────────────────────────────
KEEPERHUB_API_KEY=kh_your_key_here       # https://app.keeperhub.com/settings/api-keys
KH_REBALANCE_WORKFLOW_ID=wf_your_id     # Friend creates this in KeeperHub UI

# ── Telegram Notifications (optional but recommended for demo) ──────
TELEGRAM_BOT_TOKEN=your_bot_token        # From @BotFather
TELEGRAM_CHAT_ID=your_chat_id            # Your Telegram user/group ID
```

---

## HTTP API Reference

### `GET /health`

Liveness check. Returns immediately.

```json
{ "status": "ok", "service": "EvoYield", "timestamp": "2026-04-29T..." }
```

### `GET /status`

Returns the current active strategy's generation and fitness score.

```json
{
  "skill": {
    "name": "yield-allocator",
    "generation": 1,
    "fitnessScore": 100,
    "version": "2.0.0",
    "status": "active"
  }
}
```

### `POST /evaluate`

Main endpoint. KeeperHub or any caller sends current APYs, gets back the evolved allocation.

**Request body:**

```json
{
  "aave_apy": 3.97,
  "morpho_apy": 3.03,
  "yearn_apy": 3.49,
  "sky_apy": 0
}
```

**Response:**

```json
{
  "allocation": { "aave": 50, "yearn": 30, "morpho": 15, "sky": 5 },
  "generation": 1,
  "fitnessScore": 100
}
```

---

## Telegram Setup (5 minutes)

1. Open Telegram → search `@BotFather` → send `/newbot`
2. Follow prompts → copy the **bot token** → paste as `TELEGRAM_BOT_TOKEN` in `.env`
3. Start a chat with your new bot (click Start)
4. Visit `https://api.telegram.org/bot{YOUR_TOKEN}/getUpdates` in a browser
5. Find `"chat": { "id": 123456789 }` — paste that as `TELEGRAM_CHAT_ID` in `.env`

---

## KeeperHub Setup (Friend's Task)

This is what the other teammate needs to build in the KeeperHub UI:

### Step 1: Get API Key

Go to [app.keeperhub.com/settings/api-keys](https://app.keeperhub.com/settings/api-keys) → create a key → paste as `KEEPERHUB_API_KEY` in `.env`.

### Step 2: Create the Rebalance Workflow

Create a new workflow with **Webhook** as the trigger. The webhook payload it receives is:

```json
{
  "allocation": { "aave": 50, "yearn": 30, "morpho": 15, "sky": 5 },
  "marketData": { "aave_apy": 3.97, "morpho_apy": 3.03, "yearn_apy": 3.49, "sky_apy": 0 },
  "generation": 1,
  "fitnessScore": 100,
  "timestamp": "2026-04-29T..."
}
```

### Step 3: Build the Workflow Nodes

Recommended node sequence:

| Step | Node type         | Action                                                 |
| ---- | ----------------- | ------------------------------------------------------ |
| 1    | Trigger           | Webhook (auto-created when you pick this trigger)      |
| 2    | Read balances     | Call Aave V3, Morpho, Yearn, Sky balance APIs          |
| 3    | Calculate delta   | Compare current % vs target `allocation` from payload  |
| 4    | Withdraw          | Withdraw excess from over-allocated protocols          |
| 5    | Approve + Deposit | Approve token → deposit into under-allocated protocols |
| 6    | Verify            | Read final balances, confirm they match target         |
| 7    | Notify            | Send Telegram / Discord summary                        |

### Step 4: Paste the Workflow ID

Copy the workflow ID from KeeperHub → paste as `KH_REBALANCE_WORKFLOW_ID` in `.env`.

### Step 5: Expose the Server Publicly (for KeeperHub to call back)

If KeeperHub needs to call your `/evaluate` endpoint:

```bash
npx ngrok http 3001
```

Copy the public URL (e.g. `https://abc123.ngrok.io`) → set it as the HTTP call URL in your KeeperHub workflow nodes.

---

## What's Working Right Now

| Feature                   | Status     | Notes                                                           |
| ------------------------- | ---------- | --------------------------------------------------------------- |
| EvoFrame agent boots      | ✅ Working | Loads cached strategy on subsequent runs                        |
| 0G AI strategy evolution  | ✅ Working | Calls `qwen/qwen-2.5-7b-instruct` on 0G network                 |
| Benchmark evaluation      | ✅ Working | fitness=100, all 4 benchmarks passing                           |
| DefiLlama live APY fetch  | ✅ Working | Real data: Aave 3.97%, Yearn 3.49%, Morpho 3.03%                |
| HTTP server + REST API    | ✅ Working | `/health`, `/status`, `/evaluate` all working                   |
| KeeperHub webhook trigger | ✅ Wired   | Sends correct payload; needs `KH_REBALANCE_WORKFLOW_ID`         |
| Telegram notifications    | ✅ Wired   | Sends on cycle; needs `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` |
| On-chain attestation      | ⚠️ Stubbed | `onChainTxHash: null` — 0G chain not fully connected yet        |

---

## What Still Needs To Be Done

### Your tasks (you — the 0G side)

- [ ] **Telegram bot** — 5 min setup with @BotFather (see [Telegram Setup](#telegram-setup-5-minutes))
- [ ] **Demo video** — ETHGlobal requires a video showing the working project. Record:
  1. `node keeperhub.mjs` running and printing real APYs + allocation
  2. The KeeperHub workflow executing the rebalance
  3. Telegram notification arriving
  4. Terminal showing evolution from gen-0 to gen-1 (delete `.evoframe-cache.json` and re-run `node agent.mjs`)
- [ ] **On-chain attestation** (if 0G track requires it) — check if EvoFrame needs `onChainTxHash` set for the prize criteria. The field exists in the cache, currently null.
- [ ] **Project description on ETHGlobal** — submit under both 0G and KeeperHub tracks. Write a paragraph for each track explaining specifically how you used their tech.

### Friend's tasks (KeeperHub side)

- [ ] **Get KeeperHub API key** from [app.keeperhub.com/settings/api-keys](https://app.keeperhub.com/settings/api-keys)
- [ ] **Create rebalance workflow** in KeeperHub UI with Webhook trigger
- [ ] **Paste workflow ID** into your `.env` as `KH_REBALANCE_WORKFLOW_ID`
- [ ] **Test the full loop** end-to-end: run `node keeperhub.mjs` → confirm KeeperHub picks it up → confirm rebalance executes
- [ ] (Optional) Add the EvoYield server's `/evaluate` endpoint as an HTTP step at the start of the KeeperHub workflow, so KeeperHub can fetch its own allocation

### Both of you

- [ ] **End-to-end live test** — run the full loop together and screenshot/record it working
- [ ] **Hackathon submission form** — fill in project name, description, tech stack, GitHub link, demo video link, team names

---

## Hackathon Prize Track Requirements

### 0G Track ($7,500)

You must demonstrate **meaningful use of 0G compute or storage**. EvoYield qualifies because:

- Strategy evolution calls `qwen/qwen-2.5-7b-instruct` on the 0G compute network
- The `ComputeAdapter` from `@evoframe/0g-adapter` handles all 0G API interaction
- The storage layer (`StorageAdapter`) is 0G-compatible (currently in local mode)

**To strengthen this**: connect real 0G storage (change `localMode: false` in `instance.mjs`) and ensure the evolved skill gets stored on 0G network.

### KeeperHub Track ($4,500)

You must demonstrate **an agent that uses KeeperHub for automation**. EvoYield qualifies because:

- `triggerRebalance()` calls the KeeperHub workflow API
- The rebalance workflow executes cross-protocol DeFi operations automatically
- The cycle can be triggered on a cron schedule using KeeperHub's scheduler

**To strengthen this**: add a KeeperHub schedule trigger so the cycle runs every hour automatically without any manual `node keeperhub.mjs` call.

---

## Tech Stack

| Component       | Technology                                                                      |
| --------------- | ------------------------------------------------------------------------------- |
| Runtime         | Node.js v22, ESM modules                                                        |
| Agent framework | EvoFrame (`@evoframe/core`, `@evoframe/0g-adapter`, `@evoframe/skill-registry`) |
| AI compute      | 0G Compute Network — `qwen/qwen-2.5-7b-instruct`                                |
| APY data        | DefiLlama Yields API (free, no auth)                                            |
| Automation      | KeeperHub workflow webhooks                                                     |
| HTTP server     | Express.js                                                                      |
| Notifications   | Telegram Bot API                                                                |
| Environment     | dotenv                                                                          |

---

## EvoFrame Package Reference

EvoFrame packages live in `packages/` at the monorepo root. npm workspaces symlinks them into `node_modules/@evoframe/` automatically after `npm install`.

| Package                    | Location                   | Purpose                                                            |
| -------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `@evoframe/core`           | `packages/core/`           | Base `EvoAgent` class, evolution engine, benchmark runner          |
| `@evoframe/0g-adapter`     | `packages/0g-adapter/`     | `StorageAdapter` (0G storage) + `ComputeAdapter` (0G AI inference) |
| `@evoframe/skill-registry` | `packages/skill-registry/` | `SkillRegistryAdapter` — stores/retrieves evolved skills           |

---

## Running in Offline / Test Mode

Set `COMPUTE_MODE=local` in `.env` to skip real 0G API calls. The agent will use the cached strategy from `.evoframe-cache.json` without calling out.

To force re-evolution (delete cache → agent calls 0G on next run):

```bash
rm .evoframe-cache.json
node agent.mjs
```

---

## Known Limitations

1. **Sky APY often returns 0%** — Sky/Spark USDC pools are sometimes not listed on DefiLlama Ethereum mainnet. Sky gets 5% allocation (lowest rank) when its APY is 0.
2. **On-chain TX hash is null** — The 0G on-chain skill registration is stubbed. The agent runs in local mode (no real chain connected).
3. **KeeperHub workflow not built yet** — The rebalance trigger logs the payload but doesn't execute until `KH_REBALANCE_WORKFLOW_ID` is set.
4. **Single-chain only** — Currently targets Ethereum mainnet pools only. Multi-chain support would require changes to `apy.mjs`.

---

## File-by-File Reference

### `src/agent/EvoYieldAgent.mjs`

Extends `EvoAgent` from EvoFrame. Defines the genesis skill (naive 25/25/25/25 split), registers benchmarks, and sets the evolution hint. This is the brain of the project.

### `src/agent/benchmarks.mjs`

Four test cases the evolved strategy must pass. Each benchmark is `{ id, input, validate }`. The validate function returns 0 (fail) or 100 (pass). Average score = fitness.

### `src/agent/hint.mjs`

Plain English + algorithmic instructions sent to the 0G AI model. Extremely explicit to ensure the generated code is mathematically correct (allocations summing to 100).

### `src/agent/instance.mjs`

Singleton wrapper. Provides `initAgent()`, `evaluate(marketData)`, `getSkillInfo()`. The `_ready` guard prevents double-initialization when imported from multiple places.

### `src/server/app.mjs`

Express app. Three routes: `/health` (liveness), `/status` (current strategy info), `/evaluate` (main allocation endpoint). KeeperHub can call this to get decisions before executing.

### `src/keeperhub/client.mjs`

Base HTTP client for KeeperHub API. Adds `X-API-Key` auth header automatically. Used by `rebalance.mjs`.

### `src/keeperhub/apy.mjs`

Fetches real APY data from DefiLlama. 5-minute cache. Picks highest-TVL pool per protocol. Returns `{ aave_apy, morpho_apy, yearn_apy, sky_apy }`.

### `src/keeperhub/rebalance.mjs`

Calls `POST /workflows/{workflowId}/webhook` on KeeperHub. Sends the evolved allocation + market data. If `KH_REBALANCE_WORKFLOW_ID` is not set, logs the payload instead of crashing.

### `src/keeperhub/notify.mjs`

Sends a formatted HTML message to Telegram. Silently skips if bot token/chat ID not configured. Message includes APYs, allocation percentages, strategy generation, and KeeperHub status.

### `src/keeperhub/cycle.mjs`

Orchestrates the full pipeline. Calls each module in sequence: `initAgent → fetchApyData → evaluate → triggerRebalance → sendTelegram`. Returns the combined result object.

### `agent.mjs` (root)

Thin entry point. Loads `.env`, imports `initAgent` and `evaluate` from `src/agent/instance.mjs`, runs 4 test scenarios, prints results.

### `server.mjs` (root)

Thin entry point. Loads `.env`, imports `app` from `src/server/app.mjs`, starts listening on `PORT`.

### `keeperhub.mjs` (root)

Thin entry point. Loads `.env`, imports `runCycle` from `src/keeperhub/cycle.mjs`, runs one cycle.

---

## Team

| Track           | Contributor | Responsibility                                                                                    |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| 0G Track        | You         | EvoFrame agent, 0G compute integration, evolution strategy, HTTP server, DefiLlama integration    |
| KeeperHub Track | Friend      | KeeperHub workflow design, rebalance execution nodes, Aave/Morpho/Yearn/Sky protocol interactions |

---

## Links

- ETHGlobal Open Agents 2026: https://ethglobal.com
- 0G Compute Network: https://0g.ai
- KeeperHub: https://keeperhub.com
- EvoFrame monorepo: `packages/` (this repo)
- DefiLlama Yields API: https://yields.llama.fi/pools
