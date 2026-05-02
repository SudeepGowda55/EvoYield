import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readJson, writeJsonAtomic } from "./fs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PATH = resolve(__dirname, "../../../../apps/dashboard/public/data/latest-run.json");
const PROTOCOLS = ["aave", "morpho", "yearn", "sky"];

function normalizeAllocation(allocation = {}) {
  return Object.fromEntries(PROTOCOLS.map((protocol) => [protocol, Number(allocation[protocol] ?? 0)]));
}

function normalizeDeltas(deltas = {}) {
  const source = Array.isArray(deltas) ? Object.fromEntries(deltas.map((item) => [item.protocol, item])) : deltas;
  return PROTOCOLS.map((protocol) => {
    const item = source?.[protocol] ?? {};
    const deltaUsdc = Number(item.deltaUsdc ?? 0);
    return {
      protocol,
      previousPct: Number(item.previousPct ?? 0),
      targetPct: Number(item.targetPct ?? 0),
      previousAmountUsdc: Number(item.previousAmountUsdc ?? 0),
      targetAmountUsdc: Number(item.targetAmountUsdc ?? 0),
      deltaUsdc,
      action: item.action ?? (deltaUsdc > 0 ? "deposit" : deltaUsdc < 0 ? "withdraw" : "hold"),
    };
  });
}

function amountsFromAllocation(allocation, poolUsdc) {
  const normalized = normalizeAllocation(allocation);
  return Object.fromEntries(
    PROTOCOLS.map((protocol) => [
      protocol,
      Number(((poolUsdc * normalized[protocol]) / 100).toFixed(6)),
    ]),
  );
}

function extractWorkflowResult(khResult = {}) {
  return (
    khResult.logs?.execution?.output?.result ??
    khResult.logs?.execution?.output?.data?.result ??
    khResult.finalResult?.output?.result ??
    khResult.finalResult?.result ??
    khResult.result?.result ??
    null
  );
}

function extractTransaction(khResult = {}) {
  const output = khResult.logs?.execution?.output ?? khResult.finalResult?.output ?? {};
  const hash = output.transactionHash ?? output.result?.transactionHash ?? null;
  if (!hash) return null;

  return {
    hash,
    url: output.transactionLink ?? `https://sepolia.etherscan.io/tx/${hash}`,
    status: output.success === false ? "failed" : "success",
    gasUsedUnits: output.gasUsedUnits ?? null,
    effectiveGasPrice: output.effectiveGasPrice ?? null,
  };
}

function weightedApy(allocation, marketData = {}) {
  const normalized = normalizeAllocation(allocation);
  return Number(
    PROTOCOLS.reduce((sum, protocol) => {
      const apy = Number(marketData[`${protocol}_apy`] ?? 0);
      return sum + (normalized[protocol] / 100) * apy;
    }, 0).toFixed(2),
  );
}

function rebalanceSummary(deltas) {
  const moved = deltas.filter((item) => item.deltaUsdc !== 0);
  if (!moved.length) return "No USDC movement was needed because the target allocation matched the current pool.";

  const withdrawals = moved.filter((item) => item.deltaUsdc < 0);
  const deposits = moved.filter((item) => item.deltaUsdc > 0);
  const amount = Math.max(...moved.map((item) => Math.abs(item.deltaUsdc)));
  const from = withdrawals.map((item) => item.protocol).join(", ");
  const to = deposits.map((item) => item.protocol).join(", ");
  return `Moved ${amount.toFixed(2)} USDC from ${from || "overweight buckets"} toward ${to || "underweight buckets"} after 0G recomputed the allocation.`;
}

export async function publishDashboardRun({ marketData, result, khResult, rebalance, agentName = "EvoYield-v1" } = {}) {
  const existing = await readJson(DASHBOARD_PATH, {
    history: [],
    freshAllocation: null,
    notes: [],
  });

  const workflowResult = extractWorkflowResult(khResult);
  const transaction = extractTransaction(khResult);
  const poolUsdc = Number(workflowResult?.poolUsdc ?? rebalance?.poolUsdc ?? 1);
  const targetAllocation = normalizeAllocation(workflowResult?.targetAllocation ?? result?.allocation);
  const previousAllocation = normalizeAllocation(workflowResult?.previousAllocation ?? rebalance?.previousAllocation);
  const targetAmounts = workflowResult?.targetAmounts ?? amountsFromAllocation(targetAllocation, poolUsdc);
  const previousAmounts = workflowResult?.previousAmounts ?? amountsFromAllocation(previousAllocation, poolUsdc);
  const deltas = normalizeDeltas(workflowResult?.deltas ?? rebalance?.deltas);
  const now = khResult?.triggeredAt ?? new Date().toISOString();
  const currentExpectedApy = weightedApy(targetAllocation, marketData);
  const previousExpectedApy = weightedApy(previousAllocation, marketData);
  const expectedApyLift = Number((currentExpectedApy - previousExpectedApy).toFixed(2));
  const protocolTargets = rebalance?.protocolTargets ?? existing.protocolTargets ?? {};
  const executableProtocols = rebalance?.executableProtocols ?? existing.executableProtocols ?? [];
  const deltasWithTransactions = deltas.map((item) => ({ ...item, transaction }));

  const history = Array.isArray(existing.history) ? existing.history.filter(Boolean) : [];
  const alreadyRecorded = history.some((item) => item.executionId === khResult?.executionId);
  const nextHistory = alreadyRecorded
    ? history
    : [
        ...history,
        {
          label: deltas.some((item) => item.deltaUsdc !== 0) ? `Gen ${result?.generation} rebalance` : `Gen ${result?.generation} hold check`,
          timestamp: now,
          type: "rebalance",
          executionId: khResult?.executionId ?? "pending",
          previousAllocation,
          allocation: targetAllocation,
          deltas: deltasWithTransactions,
          transaction,
          previousExpectedApy,
          expectedApy: currentExpectedApy,
          expectedApyLift: Math.max(0, expectedApyLift),
          summary: rebalanceSummary(deltas),
        },
      ];

  await writeJsonAtomic(DASHBOARD_PATH, {
    ...existing,
    generatedAt: new Date().toISOString(),
    agent: agentName,
    chain: existing.chain ?? "Ethereum Sepolia",
    wallet: workflowResult?.wallet ?? existing.wallet,
    asset: {
      ...(existing.asset ?? {}),
      symbol: workflowResult?.asset ?? existing.asset?.symbol ?? "USDC",
      tokenAddress: workflowResult?.tokenAddress ?? existing.asset?.tokenAddress,
      poolAmount: poolUsdc,
    },
    strategy: {
      generation: Number(result?.generation ?? workflowResult?.generation ?? existing.strategy?.generation ?? 0),
      fitnessScore: Number(result?.fitnessScore ?? workflowResult?.fitnessScore ?? existing.strategy?.fitnessScore ?? 0),
      source: existing.strategy?.source ?? "0G allocation strategy",
    },
    workflow: {
      ...(existing.workflow ?? {}),
      id: khResult?.workflowId ?? existing.workflow?.id,
    },
    protocolTargets,
    executableProtocols,
    marketData: {
      timestamp: new Date().toISOString(),
      ...marketData,
    },
    rebalance: {
      timestamp: now,
      executionId: khResult?.executionId ?? existing.rebalance?.executionId,
      mode: "rebalance",
      previousAllocation,
      targetAllocation,
      previousAmounts,
      targetAmounts,
      deltas: deltasWithTransactions,
      transaction,
      protocolTargets,
      executableProtocols,
    },
    history: nextHistory,
  });
}
