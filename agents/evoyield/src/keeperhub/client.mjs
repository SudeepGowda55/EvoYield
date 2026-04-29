// Production-grade HTTP client for the KeeperHub REST API.
// Docs: https://docs.keeperhub.com/api
//
// Hardening on top of a plain fetch:
//   * Bearer + X-API-Key auth (KeeperHub historically accepted both — we send both
//     so the same client works against staging and production)
//   * Per-request timeout via AbortController (default 20s)
//   * Retry with exponential backoff on transient failures (429, 502, 503, 504)
//   * Idempotency-Key header on POST/PUT/PATCH so retries can't duplicate workflows
//   * Structured KeeperHubError with status, endpoint, requestId, body
//   * Mock mode for offline development (KH_MODE=mock) — returns deterministic
//     fake responses without hitting the network

import { randomUUID } from "node:crypto";

const DEFAULT_BASE_URL = "https://app.keeperhub.com/api";
const DEFAULT_TIMEOUT  = 20_000;
const DEFAULT_RETRIES  = 3;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class KeeperHubError extends Error {
  constructor({ status, endpoint, requestId, body, message }) {
    super(message);
    this.name      = "KeeperHubError";
    this.status    = status;
    this.endpoint  = endpoint;
    this.requestId = requestId;
    this.body      = body;
  }
}

function isMock() {
  return (process.env.KH_MODE ?? "").toLowerCase() === "mock";
}

function getApiKey() {
  const key = process.env.KEEPERHUB_API_KEY;
  if (!key || key === "kh_your_key_here") {
    if (isMock()) return "kh_mock_key";
    throw new KeeperHubError({
      status:    0,
      endpoint:  "<auth>",
      requestId: null,
      body:      null,
      message:   "KEEPERHUB_API_KEY is not configured. Set it in .env or use KH_MODE=mock.",
    });
  }
  return key;
}

function getBaseUrl() {
  return (process.env.KEEPERHUB_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Mock responses ─────────────────────────────────────────────────────────
function mockResponse(method, path, body) {
  const id = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;

  if (method === "POST" && path === "/ai/generate-workflow") {
    return {
      workflow: {
        name:        body?.name ?? "evoyield-generated",
        description: body?.prompt ?? "",
        nodes: [
          { id: "trigger", type: "trigger.schedule",  config: { cron: "0 * * * *" } },
          { id: "fetch",   type: "http.request",      config: { method: "GET", url: "{{EVOYIELD_PUBLIC_URL}}/status" } },
          { id: "branch",  type: "logic.if",          config: { condition: "fetch.body.skill.fitnessScore >= 60" } },
          { id: "rebal",   type: "onchain.multicall", config: { steps: [] } },
          { id: "notify",  type: "notify.webhook",    config: { url: "{{EVOYIELD_PUBLIC_URL}}/regenerate" } },
        ],
        edges: [
          { from: "trigger", to: "fetch" },
          { from: "fetch",   to: "branch" },
          { from: "branch",  to: "rebal", when: "true" },
          { from: "rebal",   to: "notify" },
        ],
      },
    };
  }

  if (method === "POST" && path === "/workflows") {
    return { id: id("wf"), ...body, created_at: new Date().toISOString() };
  }

  if (method === "PATCH" && path.startsWith("/workflows/")) {
    return { id: path.split("/").pop(), ...body, updated_at: new Date().toISOString() };
  }

  if (method === "DELETE" && path.startsWith("/workflows/")) {
    return { deleted: true, id: path.split("/").pop() };
  }

  if (method === "GET" && path === "/workflows") {
    return { workflows: [], total: 0 };
  }

  if (method === "POST" && path === "/executions/check-and-execute") {
    return { execution_id: id("exec"), status: "queued" };
  }

  if (method === "POST" && path.match(/^\/workflows\/[^/]+\/(execute|webhook)$/)) {
    return { execution_id: id("exec"), status: "queued" };
  }

  return { mocked: true, method, path, echo: body ?? null };
}

// ── Core fetch with retry/timeout/idempotency ──────────────────────────────
export async function khFetch(path, options = {}) {
  const {
    method   = "GET",
    body,
    headers  = {},
    timeout  = DEFAULT_TIMEOUT,
    retries  = DEFAULT_RETRIES,
    idempotencyKey,
  } = options;

  if (isMock()) return mockResponse(method, path, body);

  const apiKey = getApiKey();
  const url    = `${getBaseUrl()}${path}`;
  const isWrite = method !== "GET" && method !== "HEAD";
  const idemKey = isWrite ? (idempotencyKey ?? randomUUID()) : undefined;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type":     "application/json",
          "Accept":           "application/json",
          "Authorization":    `Bearer ${apiKey}`,
          "X-API-Key":        apiKey,
          "User-Agent":       "evoyield-keeperhub/1.0",
          ...(idemKey ? { "Idempotency-Key": idemKey } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      const requestId = res.headers.get("x-request-id") ?? res.headers.get("request-id");
      const text = await res.text();
      const json = text ? safeJson(text) : null;

      if (res.ok) return json ?? {};

      const isTransient = RETRYABLE_STATUS.has(res.status);
      const err = new KeeperHubError({
        status:    res.status,
        endpoint:  path,
        requestId,
        body:      json,
        message:   `KeeperHub [${res.status}] ${method} ${path}` +
                   (json?.error?.message ? `: ${json.error.message}` : ""),
      });

      if (isTransient && attempt < retries) {
        lastError = err;
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    } catch (err) {
      if (err instanceof KeeperHubError) throw err;
      // Network error or abort — retry
      lastError = err;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new KeeperHubError({
        status:    0,
        endpoint:  path,
        requestId: null,
        body:      null,
        message:   `KeeperHub request failed (${method} ${path}): ${err.message ?? err}`,
      });
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function backoffMs(attempt) {
  // 250ms, 500ms, 1000ms, with ±20% jitter
  const base = 250 * Math.pow(2, attempt);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

// ── Convenience wrappers used by other keeperhub/* modules ────────────────
export const kh = {
  get:    (path, opts)       => khFetch(path, { ...opts, method: "GET" }),
  post:   (path, body, opts) => khFetch(path, { ...opts, method: "POST",   body }),
  patch:  (path, body, opts) => khFetch(path, { ...opts, method: "PATCH",  body }),
  put:    (path, body, opts) => khFetch(path, { ...opts, method: "PUT",    body }),
  delete: (path, opts)       => khFetch(path, { ...opts, method: "DELETE" }),
};
