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
const walletAddress = process.env.KH_WALLET_ADDRESS ?? "0x06de353DDb9C102Cda81eDc8A535B88DFd1F7C08";
const sepoliaUsdc =
  process.env.EVOYIELD_USDC_ADDRESS ??
  process.env.SEPOLIA_USDC_ADDRESS ??
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const rebalancerAddress = process.env.EVOYIELD_REBALANCER_ADDRESS ?? "0xcaD4CE47becA13D10F885E0e78714c21FD6c1165";
const poolUsdc = process.env.EVOYIELD_TEST_POOL_USDC ?? "60.1";
const poolAssetsRaw = String(Math.round(Number(poolUsdc) * 1_000_000));
const computeLabel = `Compute ${poolUsdc} USDC Vault Rebalance`;
const protocolTargets = {
  aave: process.env.EVOYIELD_AAVE_VAULT ?? "0x02b5e71D8C0D1e0C76EF66A7bA6bB58201363BB3",
  morpho: process.env.EVOYIELD_MORPHO_VAULT ?? "0x0e2bb0C5802A1dDd4D56AB89bfC7f20732D91B5c",
  yearn: process.env.EVOYIELD_YEARN_VAULT ?? "0x24BF9F1c089b0374e3bDFA0Ed3c6D6C815D9C816",
  sky: process.env.EVOYIELD_SKY_VAULT ?? "0xc0468ee91158e409814de57a7918217B30589a70",
};

if (!apiKey) throw new Error("KEEPERHUB_API_KEY is missing");
if (!workflowId) throw new Error("KH_REBALANCE_WORKFLOW_ID is missing");

const code = `
const payload = {{Webhook.data}};
const rebalance = payload?.rebalance;
if (!rebalance) throw new Error('Missing rebalance context from EvoYield');

const protocols = ['aave', 'morpho', 'yearn', 'sky'];
const protocolTargets = payload?.rebalance?.protocolTargets ?? ${JSON.stringify(protocolTargets)};
const target = payload?.allocation ?? rebalance.targetAllocation ?? {};
const bps = Object.fromEntries(protocols.map((protocol) => [
  protocol,
  Math.round(Number(target[protocol] ?? 0) * 100),
]));
const bpsTotal = protocols.reduce((sum, protocol) => sum + bps[protocol], 0);
if (bpsTotal !== 10000) throw new Error('Target BPS must sum to 10000, got ' + bpsTotal);

const deltas = protocols.map((protocol) => {
  const item = rebalance.deltas?.[protocol] ?? {};
  const targetAddress = protocolTargets[protocol] ?? null;
  return {
    protocol,
    targetAddress,
    executable: Boolean(targetAddress),
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
  rebalancerAddress: ${JSON.stringify(rebalancerAddress)},
  wallet: ${JSON.stringify(walletAddress)},
  poolUsdc: Number(${JSON.stringify(poolUsdc)}),
  poolAssetsRaw: ${JSON.stringify(poolAssetsRaw)},
  aaveBps: bps.aave,
  morphoBps: bps.morpho,
  yearnBps: bps.yearn,
  skyBps: bps.sky,
  rebalanceArgs: [
    ${JSON.stringify(poolAssetsRaw)},
    String(bps.aave),
    String(bps.morpho),
    String(bps.yearn),
    String(bps.sky),
  ],
  functionArgsJson: JSON.stringify([
    ${JSON.stringify(poolAssetsRaw)},
    String(bps.aave),
    String(bps.morpho),
    String(bps.yearn),
    String(bps.sky),
  ]),
  previousAllocation: rebalance.previousAllocation,
  targetAllocation: rebalance.targetAllocation,
  previousAmounts: rebalance.previousAmounts,
  targetAmounts: rebalance.targetAmounts,
  protocolTargets,
  executableProtocols: protocols.filter((protocol) => Boolean(protocolTargets[protocol])),
  deltas,
  generation: payload?.generation,
  fitnessScore: payload?.fitnessScore,
  note: 'This workflow manages exactly ${poolUsdc} Sepolia USDC through EvoYieldRebalancer.rebalanceAmountToTargets.',
};
`.trim();

const rebalanceAbi = [
  {
    type: "function",
    name: "rebalanceAmountToTargets",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolAssets", type: "uint256" },
      { name: "aaveBps", type: "uint256" },
      { name: "morphoBps", type: "uint256" },
      { name: "yearnBps", type: "uint256" },
      { name: "skyBps", type: "uint256" },
    ],
    outputs: [],
  },
];

function writeContractNode({ id, label, description, x, contractAddress, functionName, abi, functionArgs }) {
  const signature = `${functionName}(${abi[0].inputs.map((input) => input.type).join(",")})`;
  return {
    id,
    type: "action",
    position: { x, y: 0 },
    data: {
      type: "action",
      label,
      description,
      config: {
        actionType: "web3/write-contract",
        network: "11155111",
        contractAddress,
        abi: JSON.stringify(abi),
        abiFunction: functionName,
        functionArgs,
        ethValue: "0",
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
      label: computeLabel,
      description: "Computes vault target BPS and raw 6-decimal USDC amount",
      config: { actionType: "code/run-code", code, timeout: 60 },
    },
  },
  writeContractNode({
    id: "rebalance-vaults",
    label: "Rebalance Mock Vaults",
    description: "Calls rebalanceAmountToTargets on the deployed EvoYieldRebalancer",
    x: 700,
    contractAddress: rebalancerAddress,
    functionName: "rebalanceAmountToTargets",
    abi: rebalanceAbi,
    functionArgs: JSON.stringify([
      poolAssetsRaw,
      `{{@compute-usdc-rebalance:${computeLabel}.result.aaveBps}}`,
      `{{@compute-usdc-rebalance:${computeLabel}.result.morphoBps}}`,
      `{{@compute-usdc-rebalance:${computeLabel}.result.yearnBps}}`,
      `{{@compute-usdc-rebalance:${computeLabel}.result.skyBps}}`,
    ]),
  }),
];

const edges = [
  { id: "webhook-to-rebalance", type: "animated", source: "webhook-trigger", target: "compute-usdc-rebalance" },
  { id: "rebalance-to-write", type: "animated", source: "compute-usdc-rebalance", target: "rebalance-vaults" },
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
      `Receives EvoYield allocation and rebalances exactly ${poolUsdc} Sepolia USDC across mock vaults.`,
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
  rebalancerAddress,
  poolUsdc,
  poolAssetsRaw,
  protocolTargets,
  nodes: json.nodes?.map((n) => ({
    id: n.id,
    label: n.data?.label,
    actionType: n.data?.config?.actionType,
    contractAddress: n.data?.config?.contractAddress,
    functionName: n.data?.config?.functionName,
  })),
  error: json.error,
}, null, 2));

if (!res.ok) process.exitCode = 1;
