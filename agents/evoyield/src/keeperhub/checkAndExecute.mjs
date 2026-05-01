// Direct on-chain execution via KeeperHub's `execute_check_and_execute`.
//
// Used as the fast-path fallback when the agent wants to rebalance a single
// position immediately, without round-tripping through a full workflow.
// KeeperHub guarantees: gas estimation, nonce mgmt, MEV-safe routing.

import { kh, KeeperHubError } from "./client.mjs";

const PATHS = {
  checkAndExecute:  process.env.KH_PATH_CHECK_EXEC      ?? "/executions/check-and-execute",
  contractCall:     process.env.KH_PATH_CONTRACT_CALL   ?? "/executions/contract-call",
  status:           (id) => `/workflows/executions/${encodeURIComponent(id)}/status`,
  logs:             (id) => `/workflows/executions/${encodeURIComponent(id)}/logs`,
};

/**
 * Submit a conditional onchain call.
 * @param {object} args
 * @param {string} args.network             e.g. "ethereum", "base", "arbitrum"
 * @param {string} args.contractAddress     target contract
 * @param {string} args.functionName        readonly function used as a precondition
 * @param {object} args.condition           { op: "lt"|"gt"|"eq"|"gte"|"lte", value: any }
 * @param {object} args.action              { functionName, args, value? }
 * @param {object} [args.abi]               optional ABI to pin types
 */
export async function submitCheckAndExecute({
  network,
  contractAddress,
  functionName,
  functionArgs,
  condition,
  action,
  abi,
  idempotencyKey,
}) {
  if (!network || !contractAddress || !functionName || !condition || !action) {
    throw new TypeError("submitCheckAndExecute: missing required fields");
  }

  const body = {
    network,
    contract_address: contractAddress,
    function_name:    functionName,
    function_args:    functionArgs ?? [],
    condition,
    action,
    ...(abi ? { abi } : {}),
  };

  const resp = await kh.post(PATHS.checkAndExecute, body, {
    idempotencyKey: idempotencyKey ?? `cae:${network}:${contractAddress}:${functionName}:${Date.now()}`,
  });

  const executionId = resp.execution_id ?? resp.id;
  if (!executionId) {
    throw new KeeperHubError({
      status: 502, endpoint: PATHS.checkAndExecute, requestId: null, body: resp,
      message: "check-and-execute did not return execution_id",
    });
  }
  return { executionId, status: resp.status ?? "queued" };
}

/** Poll execution status until it reaches a terminal state, or we time out. */
export async function waitForExecution(executionId, { timeoutMs = 120_000, intervalMs = 3_000 } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await kh.get(PATHS.status(executionId));
    const s = (last.status ?? "").toLowerCase();
    if (["success", "succeeded", "completed", "failed", "error", "rejected", "cancelled"].includes(s)) {
      return last;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new KeeperHubError({
    status: 408, endpoint: PATHS.status(executionId), requestId: null, body: last,
    message: `execution ${executionId} did not reach a terminal state within ${timeoutMs}ms`,
  });
}

export async function getExecutionLogs(executionId) {
  return kh.get(PATHS.logs(executionId));
}
