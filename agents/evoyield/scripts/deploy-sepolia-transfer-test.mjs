import { createRequire } from "module";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require("dotenv").config({ path: resolve(__dirname, "../.env") });

const base = (process.env.KEEPERHUB_API_URL ?? "https://app.keeperhub.com/api").replace(/\/+$/, "");
const apiKey = process.env.KEEPERHUB_API_KEY;
const workflowId = process.env.KH_REBALANCE_WORKFLOW_ID;
const walletId = process.env.KH_WALLET_INTEGRATION_ID ?? "q42id6rvmca5wrt36phoy";
const walletAddress = "0x06de353DDb9C102Cda81eDc8A535B88DFd1F7C08";

if (!apiKey) throw new Error("KEEPERHUB_API_KEY is missing");
if (!workflowId) throw new Error("KH_REBALANCE_WORKFLOW_ID is missing");

const computeCode = `
const payload = {{Webhook.data}};
return {
  success: true,
  chain: 'sepolia',
  network: '11155111',
  wallet: ${JSON.stringify(walletAddress)},
  testTransfer: {
    asset: 'ETH',
    amount: '0.0001',
    toAddress: ${JSON.stringify(walletAddress)},
    purpose: 'KeeperHub write-path smoke test on Sepolia'
  },
  allocation: payload?.allocation,
  marketData: payload?.marketData,
  generation: payload?.generation,
  fitnessScore: payload?.fitnessScore
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
      config: { triggerType: "Webhook", webhookSchema: "[]", webhookMockRequest: "" },
    },
  },
  {
    id: "compute-transfer-test",
    type: "action",
    position: { x: 320, y: 0 },
    data: {
      type: "action",
      label: "Compute Sepolia Transfer Test",
      description: "Builds a Sepolia ETH transfer smoke-test from the EvoYield trigger",
      config: { actionType: "code/run-code", code: computeCode, timeout: 60 },
    },
  },
  {
    id: "send-test-eth",
    type: "action",
    position: { x: 680, y: 0 },
    data: {
      type: "action",
      label: "Send 0.0001 Sepolia ETH",
      description: "Transfers 0.0001 Sepolia ETH from the connected wallet to itself as a write-path test",
      config: {
        actionType: "web3/transfer-funds",
        network: "11155111",
        toAddress: walletAddress,
        recipientAddress: walletAddress,
        recipient: walletAddress,
        amount: "0.0001",
        walletId,
      },
    },
  },
];

const edges = [
  { id: "webhook-to-compute", type: "animated", source: "webhook-trigger", target: "compute-transfer-test" },
  { id: "compute-to-transfer", type: "animated", source: "compute-transfer-test", target: "send-test-eth" },
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
    name: "EvoYield Sepolia Transfer Test",
    description:
      "Receives EvoYield allocation and sends 0.0001 Sepolia ETH from the connected wallet to itself as a KeeperHub write-path smoke test.",
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
  edges: json.edges,
  error: json.error,
}, null, 2));

if (!res.ok) process.exitCode = 1;
