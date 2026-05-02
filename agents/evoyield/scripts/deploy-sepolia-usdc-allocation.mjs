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
const sepoliaUsdc = process.env.SEPOLIA_USDC_ADDRESS ?? "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const poolUsdc = process.env.EVOYIELD_TEST_POOL_USDC ?? "1";

const recipients = {
  aave: process.env.AAVE_SEPOLIA_RECIPIENT ?? walletAddress,
  morpho: process.env.MORPHO_SEPOLIA_RECIPIENT ?? walletAddress,
  yearn: process.env.YEARN_SEPOLIA_RECIPIENT ?? walletAddress,
  sky: process.env.SKY_SEPOLIA_RECIPIENT ?? walletAddress,
};

if (!apiKey) throw new Error("KEEPERHUB_API_KEY is missing");
if (!workflowId) throw new Error("KH_REBALANCE_WORKFLOW_ID is missing");

const computeCode = `
const payload = {{Webhook.data}};
const allocation = payload?.allocation ?? {};
const marketData = payload?.marketData ?? {};
const poolUsdc = Number(payload?.totalCapitalUsdc ?? ${JSON.stringify(poolUsdc)});
const recipients = ${JSON.stringify(recipients)};
const labels = {
  aave: 'Aave V3 bucket',
  morpho: 'Morpho bucket',
  yearn: 'Yearn V3 bucket',
  sky: 'Sky bucket',
};

const protocols = ['aave', 'morpho', 'yearn', 'sky'];
const targets = protocols.map((protocol) => {
  const targetPct = Number(allocation[protocol] ?? 0);
  return {
    protocol,
    label: labels[protocol],
    targetPct,
    amountUsdc: Number((poolUsdc * targetPct / 100).toFixed(6)),
    recipient: recipients[protocol],
    marketApy: Number(marketData[protocol + '_apy'] ?? 0),
  };
});

const sumPct = targets.reduce((sum, item) => sum + item.targetPct, 0);
const sumAmount = targets.reduce((sum, item) => sum + item.amountUsdc, 0);
if (Math.abs(sumPct - 100) > 1) throw new Error('Allocation must sum to 100, got ' + sumPct);

return {
  success: true,
  network: 'sepolia',
  asset: 'USDC',
  tokenAddress: ${JSON.stringify(sepoliaUsdc)},
  wallet: ${JSON.stringify(walletAddress)},
  poolUsdc,
  allocatedUsdc: Number(sumAmount.toFixed(6)),
  generation: payload?.generation,
  fitnessScore: payload?.fitnessScore,
  targets,
  note: 'This workflow executes four Sepolia USDC token transfers. Replace bucket recipients with real protocol/vault addresses when available.',
};
`.trim();

function tokenTransferNode({ id, label, amount, recipient, x }) {
  return {
    id,
    type: "action",
    position: { x, y: 0 },
    data: {
      type: "action",
      label,
      description: `Transfers ${amount} Sepolia USDC for ${label}`,
      config: {
        actionType: "web3/transfer-token",
        network: "11155111",
        tokenAddress: sepoliaUsdc,
        amount,
        toAddress: recipient,
        recipientAddress: recipient,
        recipient,
        walletId,
      },
    },
  };
}

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
    id: "compute-usdc-allocation",
    type: "action",
    position: { x: 320, y: 0 },
    data: {
      type: "action",
      label: "Compute 1 USDC Allocation",
      description: "Computes the 1 USDC pool split across Aave, Morpho, Yearn, and Sky",
      config: { actionType: "code/run-code", code: computeCode, timeout: 60 },
    },
  },
  tokenTransferNode({ id: "transfer-aave-usdc", label: "Allocate Aave USDC", amount: "0.5", recipient: recipients.aave, x: 680 }),
  tokenTransferNode({ id: "transfer-morpho-usdc", label: "Allocate Morpho USDC", amount: "0.15", recipient: recipients.morpho, x: 1040 }),
  tokenTransferNode({ id: "transfer-yearn-usdc", label: "Allocate Yearn USDC", amount: "0.3", recipient: recipients.yearn, x: 1400 }),
  tokenTransferNode({ id: "transfer-sky-usdc", label: "Allocate Sky USDC", amount: "0.05", recipient: recipients.sky, x: 1760 }),
];

const edges = [
  { id: "webhook-to-compute", type: "animated", source: "webhook-trigger", target: "compute-usdc-allocation" },
  { id: "compute-to-aave", type: "animated", source: "compute-usdc-allocation", target: "transfer-aave-usdc" },
  { id: "aave-to-morpho", type: "animated", source: "transfer-aave-usdc", target: "transfer-morpho-usdc" },
  { id: "morpho-to-yearn", type: "animated", source: "transfer-morpho-usdc", target: "transfer-yearn-usdc" },
  { id: "yearn-to-sky", type: "animated", source: "transfer-yearn-usdc", target: "transfer-sky-usdc" },
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
    name: "EvoYield Sepolia USDC Allocator",
    description:
      "Receives EvoYield allocation and executes a 1 USDC Sepolia allocation as four ERC20 transfers.",
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
  tokenAddress: sepoliaUsdc,
  recipients,
  nodes: json.nodes?.map((n) => ({
    id: n.id,
    label: n.data?.label,
    actionType: n.data?.config?.actionType,
    amount: n.data?.config?.amount,
    toAddress: n.data?.config?.toAddress,
  })),
  error: json.error,
}, null, 2));

if (!res.ok) process.exitCode = 1;
