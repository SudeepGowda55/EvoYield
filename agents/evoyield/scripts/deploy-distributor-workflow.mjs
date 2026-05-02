import { createRequire } from "module";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require("dotenv").config({ path: resolve(__dirname, "../.env") });

const base = (process.env.KEEPERHUB_API_URL ?? "https://app.keeperhub.com/api").replace(/\/+$/, "");
const apiKey = process.env.KEEPERHUB_API_KEY;
const workflowId = process.env.KH_REBALANCE_WORKFLOW_ID;
const walletAddress = process.env.KH_WALLET_ADDRESS ?? null;

if (!apiKey) throw new Error("KEEPERHUB_API_KEY is missing");
if (!workflowId) throw new Error("KH_REBALANCE_WORKFLOW_ID is missing");

const code = `
const payload = {{Webhook.data}};
const allocation = payload?.allocation ?? {};
const marketData = payload?.marketData ?? {};
const wallet = payload?.walletAddress ?? ${JSON.stringify(walletAddress)};
const asset = payload?.asset ?? 'USDC';
const totalCapital = Number(payload?.totalCapitalUsdc ?? 0);

const protocols = [
  { key: 'aave', label: 'Aave V3', action: 'supply/withdraw via Aave V3 plugin' },
  { key: 'morpho', label: 'Morpho', action: 'supply/withdraw via Morpho plugin' },
  { key: 'yearn', label: 'Yearn V3', action: 'deposit/withdraw via Yearn V3 vault plugin' },
  { key: 'sky', label: 'Sky', action: 'deposit/withdraw via Sky savings plugin' },
];

const targets = protocols.map((p) => {
  const targetPct = Number(allocation[p.key] ?? 0);
  return {
    protocol: p.key,
    label: p.label,
    targetPct,
    targetAmountUsdc: totalCapital > 0 ? Number((totalCapital * targetPct / 100).toFixed(6)) : null,
    marketApy: Number(marketData[p.key + '_apy'] ?? 0),
    keeperhubAction: p.action,
  };
});

const sum = targets.reduce((n, p) => n + p.targetPct, 0);
if (Math.abs(sum - 100) > 1) throw new Error('Allocation must sum to 100, got ' + sum);

return {
  success: true,
  mode: totalCapital > 0 ? 'amount-distribution' : 'percentage-distribution',
  wallet,
  asset,
  totalCapitalUsdc: totalCapital || null,
  generation: payload?.generation,
  fitnessScore: payload?.fitnessScore,
  targets,
  nextStep: 'Attach protocol write nodes using wallet integration q42id6rvmca5wrt36phoy to execute these targets onchain.',
};
`.trim();

const nodes = [
  {
    id: "webhook-trigger",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: {
      type: "trigger",
      label: "Webhook",
      description: "Receives EvoYield allocation payload",
      config: {
        triggerType: "Webhook",
        webhookSchema: "[]",
        webhookMockRequest: "",
      },
    },
  },
  {
    id: "compute-distribution",
    type: "action",
    position: { x: 320, y: 0 },
    data: {
      type: "action",
      label: "Compute Four-Protocol Distribution",
      description: "Computes target distribution across Aave, Morpho, Yearn, and Sky from EvoYield allocation",
      config: {
        actionType: "code/run-code",
        code,
        timeout: 60,
      },
    },
  },
];

const edges = [
  {
    id: "webhook-to-distribution",
    type: "animated",
    source: "webhook-trigger",
    target: "compute-distribution",
  },
];

const res = await fetch(`${base}/workflows/${encodeURIComponent(workflowId)}`, {
  method: "PATCH",
  headers: {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
    "X-API-Key": apiKey,
  },
  body: JSON.stringify({
    name: "EvoYield Four-Protocol Distributor",
    description:
      "Receives EvoYield allocation and computes Aave/Morpho/Yearn/Sky target distribution. " +
      "Ready for wallet-connected protocol write nodes.",
    nodes,
    edges,
    enabled: true,
    visibility: "private",
    workflowType: "read",
    category: "defi",
    chain: "ethereum",
  }),
});

const text = await res.text();
let json;
try {
  json = text ? JSON.parse(text) : {};
} catch {
  json = { raw: text };
}

console.log(`PATCH /workflows/${workflowId} -> ${res.status}`);
console.log(JSON.stringify({
  id: json.id,
  name: json.name,
  enabled: json.enabled,
  nodes: json.nodes?.map((n) => ({
    id: n.id,
    label: n.data?.label,
    actionType: n.data?.config?.actionType,
  })),
  edges: json.edges,
  error: json.error,
}, null, 2));

if (!res.ok) process.exitCode = 1;
