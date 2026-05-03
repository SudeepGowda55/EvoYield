const PROTOCOLS = ["aave", "morpho", "yearn", "sky"];

function normalizeAllocation(allocation = {}) {
  return Object.fromEntries(
    PROTOCOLS.map((protocol) => [protocol, Number(allocation[protocol] ?? 0)]),
  );
}

function extractWorkflowResult(khResult = {}) {
  const executionOutput = khResult.logs?.execution?.output ?? khResult.finalResult?.output ?? {};
  if (executionOutput?.result) return executionOutput.result;

  const logs = Array.isArray(khResult.logs?.logs) ? khResult.logs.logs : [];
  for (const log of logs) {
    if (log?.output?.result) return log.output.result;
    if (log?.output?.data?.rebalance) return log.output.data.rebalance;
    if (log?.output?.data?.allocation) {
      return {
        targetAllocation: log.output.data.allocation,
        previousAllocation: log.output.data.rebalance?.previousAllocation,
      };
    }
  }

  return null;
}

function weightedApy(allocation, marketData = {}) {
  const normalized = normalizeAllocation(allocation);
  return Number(
    PROTOCOLS.reduce((sum, protocol) => {
      const apy = Number(marketData[`${protocol}_apy`] ?? 0);
      return sum + (normalized[protocol] / 100) * apy;
    }, 0).toFixed(4),
  );
}

export function assessKeeperHubEfficiency(khResult, marketData, {
  threshold = Number(process.env.KH_EFFICIENCY_THRESHOLD ?? 70),
} = {}) {
  const workflowResult = extractWorkflowResult(khResult);
  if (!workflowResult?.targetAllocation) {
    return {
      available: false,
      shouldRegenerate: false,
      reason: "KeeperHub execution output did not include target allocation data.",
    };
  }

  const targetAllocation = normalizeAllocation(workflowResult.targetAllocation);
  const previousAllocation = normalizeAllocation(workflowResult.previousAllocation);
  const targetExpectedApy = weightedApy(targetAllocation, marketData);
  const previousExpectedApy = weightedApy(previousAllocation, marketData);
  const bestProtocolApy = Math.max(...PROTOCOLS.map((protocol) => Number(marketData[`${protocol}_apy`] ?? 0)));
  const efficiencyScore = bestProtocolApy > 0
    ? Number(((targetExpectedApy / bestProtocolApy) * 100).toFixed(2))
    : 100;
  const expectedApyLift = Number((targetExpectedApy - previousExpectedApy).toFixed(4));

  return {
    available: true,
    shouldRegenerate: efficiencyScore < threshold,
    threshold,
    efficiencyScore,
    expectedApyLift,
    targetExpectedApy,
    previousExpectedApy,
    targetAllocation,
    previousAllocation,
    source: "keeperhub-execution-logs",
    reason:
      `KeeperHub reported allocation efficiency ${efficiencyScore}/100 ` +
      `(threshold ${threshold}); expected APY lift ${expectedApyLift.toFixed(4)} pts.`,
  };
}
