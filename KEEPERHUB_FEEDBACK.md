# KeeperHub Builder Feedback — EvoYield / ETHGlobal Open Agents 2026

Submitted for the KeeperHub Builder Feedback Bounty ($250).

This feedback was collected during real integration work building EvoYield — a self-evolving DeFi agent that auto-synthesises KeeperHub workflows, live-patches BPS values before each trigger, and receives performance callbacks from KeeperHub back to the agent. All bugs and friction points below were encountered under hackathon time pressure.

---

## Reproducible Bugs

### 1. discord/send-message input key mismatch

Docs say the input key is `"Message"`. The plugin runtime requires `"discordMessage"`. REST PATCH accepts the wrong key with 200 OK and persists it — runtime then sends `{ content: undefined }` and Discord returns `"Cannot send an empty message."` The REST layer does zero schema validation.

**Steps to reproduce:**
1. Create a workflow node with `actionType: "discord/send-message"` and key `"Message": "hello"`
2. PATCH — returns 200 OK
3. Trigger workflow — Discord API returns `Cannot send an empty message`

---

### 2. actionType: "webhook/send" silently dropped by executor

PATCH returns 200, the UI renders the node, the run finishes with `status: success`, but the `executionTrace` simply omits the node. No error, no warning — a false green.

**Steps to reproduce:**
1. Add node with `actionType: "webhook/send"` (correct is `webhook/send-webhook`)
2. PATCH — returns 200, UI renders node
3. Trigger — run completes `status: success`, node absent from `executionTrace`

---

### 3. completedSteps returned as string, totalSteps as null after success

`GET /api/workflows/{id}/executions` returns `completedSteps: "4"` (string) and `totalSteps: null` on a successfully completed run. Breaks any typed client consuming these fields.

---

### 4. Cross-node template inlined into code/run-code as unquoted JS

```js
const TX = "{{@rebalance-vaults:Rebalance Mock Vaults.transactionLink}}"
```

Produced `Unexpected identifier 'https'`. The engine inlined the URL without quoting it. The error message showed no rendered source — completely undebuggable.

---

### 5. GET /api/workflows/{id}/runs returns Next.js HTML 404 instead of JSON

Wrong path should still return a JSON error response, not an HTML page.

---

### 6. Webhook 401 with kh_ key returns empty error body

The endpoint requires a `wfb_` key but the 401 response body is empty. Only discoverable by reading the auth docs carefully. The error should say: `"Requires wfb_ user-scoped key, got kh_"`.

---

## UX Friction

### 1. code/run-code fetch is advertised but discord.com is silently SSRF-blocked

The error reads: `sandbox fetch: SSRF blocked (discord.com -> 64:ff9b::...)`. No egress allowlist is published anywhere. The docs use CoinGecko as the fetch example, which works — giving the false impression that fetch is general-purpose. This creates a catch-22: Discord is blocked in the sandbox, but the dedicated `discord/send-message` plugin is the only workaround — and that plugin has the key mismatch bug above.

### 2. REST PATCH is a full-replace with no dry-run option

One forgotten node and you wipe the entire workflow. No `?dryRun=true`, no per-node PATCH endpoint, no merge strategy. We lost a workflow config doing this.

### 3. Run panel can't distinguish pending / skipped / config-invalid

All three states render identically grey. Skipped nodes need a tooltip explaining why they were skipped — otherwise silent executor drops produce false-green runs with no visible indication.

### 4. web3/write-contract doesn't preflight token allowances

Our rebalance failed with an insufficient allowance error. No configure-time hint is shown even though `web3/check-allowance` exists as a sibling plugin. Statically detecting ERC20/ERC4626 approval requirements from the ABI and surfacing them at configure time would have saved us significant debugging time.

---

## Documentation Gaps

### 1. No canonical config JSON shape on plugin pages

The Discord plugin doc says `"Inputs: Message"` but never shows the actual object:
```json
{
  "actionType": "discord/send-message",
  "integrationId": "...",
  "discordMessage": "..."
}
```
Every plugin page needs a worked example of the full config object. We had to scrape plugin source code to find the correct keys.

### 2. No published egress policy for code/run-code

`"Available globals"` lists `fetch` but says nothing about which domains are blocked. Discord, Slack, and Telegram are SSRF-blocked with no mention anywhere — the only hint is the runtime error message.

### 3. Template DSL has multiple undocumented forms with no grammar reference

We encountered at least five template syntaxes across the docs:
- `{{Manual.x}}`
- `{{Webhook.data}}`
- `{{NodeName.x}}`
- `{{@id:Label.x}}`
- `{{@batch.results[0].result}}`

No single reference explains all forms, escaping rules, or which syntax applies in which context.

### 4. Webhook plugin name mismatch between docs and runtime

Real action ID is `webhook/send-webhook`. Some doc pages imply `webhook/send`. This is exactly what caused the executor to silently drop our step with no error.

---

## Feature Requests

### 1. GET /api/action-schemas?type=... on REST ← highest priority

MCP has this endpoint; REST doesn't. This single addition would fix:
- Wrong config key accepted silently (Discord `discordMessage` vs `Message`)
- Unknown `actionType` silently dropped by executor (`webhook/send` accepted, never run)
- No schema validation on PATCH
- No canonical config shape in plugin docs

All four issues close with one endpoint.

### 2. PATCH-time schema validation

Run `validate_plugin_config` server-side on every PATCH. Return per-node errors for missing required fields, unknown keys, and invalid action types. A 200 OK that silently accepts bad config and only fails at runtime is the root cause of several bugs above.

### 3. Partial-success run status with nodeStatuses for skipped nodes

When the executor skips an unrecognised node, overall `status` must not be `success`. `nodeStatuses` should include skipped nodes with a `reason` string.

### 4. "Re-run with same input" button on failed runs

Currently you must re-trigger end-to-end from the source. For us that meant re-running the entire 0G Compute agent cycle just to retry a single failed workflow step. A replay button on any failed run would save significant time.

### 5. Always JSON.stringify template values inlined into code/run-code

A string value upstream (e.g. a transaction URL) should never produce invalid JS when inlined. Wrap it in quotes automatically and show the rendered source in error logs so `Unexpected identifier 'https'` becomes a debuggable error with context.

---

## Top 5 — If Forced to Pick

1. `GET /api/action-schemas` on REST — closes every "wrong key / wrong type silently accepted" failure mode at once
2. PATCH-time validation — reject bad config at write time, not at runtime
3. Partial-success + `nodeStatuses` with reason for skipped nodes — stops false-green runs
4. Document code/run-code egress policy and link SSRF errors to dedicated plugins
5. JSON.stringify template inlining + show rendered code in error output

---

## Project Context

- Repo: [github.com/SudeepGowda55/EvoYield](https://github.com/SudeepGowda55/EvoYield)
- Live dashboard: [evoyield.vercel.app](https://evoyield.vercel.app)
- KeeperHub workflow: `6u8xvdzjhvnbzlu7jw74s` — 24 on-chain executions on Sepolia
