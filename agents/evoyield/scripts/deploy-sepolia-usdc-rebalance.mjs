import { createRequire } from "module";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require("dotenv").config({ path: resolve(__dirname, "../.env") });

const base = (process.env.KEEPERHUB_API_URL ?? "https://app.keeperhub.com/api").replace(/\/+$/, "");
const apiKey = process.env.KEEPERHUB_API_KEY;
const workflowId = process.env.KH_REBALANCE_WORKFLOW_ID;
const walletAddress = "0x06de353DDb9C102Cda81eDc8A535B88DFd1F7C08";
const sepoliaUsdc = process.env.SEPOLIA_USDC_ADDRESS ?? "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

if (!apiKey) throw new Error("KEEPERHUB_API_KEY is missing");
if (!workflowId) throw new Error("KH_REBALANCE_WORKFLOW_ID is missing");

const code = `
const payload = {{Webhook.data}};
const rebalance = payload?.rebalance;
if (!rebalance) throw new Error('Missing rebalance context from EvoYield');

const protocols = ['aave', 'morpho', 'yearn', 'sky'];
const deltas = protocols.map((protocol) => {
  const item = rebalance.deltas?.[protocol] ?? {};
  return {
    protocol,
    previousPct: item.previousPct ?? 0,
    targetPct: item.targetPct ?? 0,
    previousAmountUsdc: item.previousAmountUsdc ?? 0,
    targetAmountUsdc: item.targetAmountUsdc ?? 0,
    deltaUsdc: item.deltaUsdc ?? 0,
    action: item.action ?? 'hold',
    execution:
      item.action === 'deposit'
        ? 'deposit delta into protocol bucket'
        : item.action === 'withdraw'
          ? 'withdraw delta from protocol bucket'
          : 'no movement needed',
  };
});

return {
  success: true,
  mode: rebalance.isInitialAllocation ? 'initial-allocation' : 'rebalance',
  network: 'sepolia',
  asset: 'USDC',
  tokenAddress: ${JSON.stringify(sepoliaUsdc)},
  wallet: ${JSON.stringify(walletAddress)},
  poolUsdc: rebalance.poolUsdc,
  previousAllocation: rebalance.previousAllocation,
  targetAllocation: rebalance.targetAllocation,
  previousAmounts: rebalance.previousAmounts,
  targetAmounts: rebalance.targetAmounts,
  deltas,
  generation: payload?.generation,
  fitnessScore: payload?.fitnessScore,
  note: 'This computes the rebalance for the already allocated 1 USDC pool. Real withdraw/deposit execution needs protocol/bucket addresses for Aave, Morpho, Yearn, and Sky.',
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
      description: "Receives EvoYield allocation and rebalance payload",
      config: { triggerType: "Webhook", webhookSchema: "[]", webhookMockRequest: "" },
    },
  },
  {
    id: "compute-usdc-rebalance",
    type: "action",
    position: { x: 320, y: 0 },
    data: {
      type: "action",
      label: "Compute 1 USDC Rebalance",
      description: "Computes deltas for the already allocated 1 USDC pool",
      config: { actionType: "code/run-code", code, timeout: 60 },
    },
  },
];

const edges = [
  { id: "webhook-to-rebalance", type: "animated", source: "webhook-trigger", target: "compute-usdc-rebalance" },
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
    name: "EvoYield Sepolia USDC Rebalancer",
    description:
      "Receives EvoYield allocation and computes rebalance deltas for the already allocated 1 USDC Sepolia pool.",
    nodes,
    edges,
    enabled: true,
    visibility: "private",
    workflowType: "write",
    category: "defi",
    chain: "sepolia",
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
  error: json.error,
}, null, 2));

if (!res.ok) process.exitCode = 1;
