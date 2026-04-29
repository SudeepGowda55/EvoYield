// x402 payment middleware for the agent's paid endpoints.
//
// x402 is the "HTTP 402 Payment Required" protocol used to let autonomous
// agents pay per-call without managing API keys: the server replies 402 with
// payment requirements; the client signs an EIP-3009 transferWithAuthorization
// for the requested token amount and retries with an X-Payment header; the
// server submits the signed authorization to a facilitator which settles the
// transfer onchain and returns a verification token.
//
// This middleware implements the server side of that flow. Verification can
// be delegated to a facilitator (X402_FACILITATOR_URL) or — if you want zero
// external deps — disabled with X402_VERIFY=false for the demo, in which
// case the signed payload is parsed but not settled (still useful as a
// hackathon demo of the protocol shape).

import { randomUUID } from "node:crypto";

const DEFAULTS = {
  network:   process.env.X402_NETWORK   ?? "base",                                            // base / base-sepolia
  asset:     process.env.X402_ASSET     ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",      // USDC on Base mainnet
  decimals:  Number(process.env.X402_DECIMALS ?? 6),
  receiver:  process.env.X402_RECEIVER  ?? null,                                              // your treasury
  priceUsdc: Number(process.env.X402_PRICE_USDC ?? 0.01),                                    // 1 cent per /evaluate call
  facilitator: process.env.X402_FACILITATOR_URL ?? null,
  verify:    (process.env.X402_VERIFY ?? "true").toLowerCase() !== "false",
};

function paymentRequirements({ resource, nonce }) {
  const amount = BigInt(Math.round(DEFAULTS.priceUsdc * 10 ** DEFAULTS.decimals)).toString();
  return {
    x402Version: 1,
    accepts: [
      {
        scheme:        "exact",
        network:       DEFAULTS.network,
        maxAmountRequired: amount,
        asset:         DEFAULTS.asset,
        payTo:         DEFAULTS.receiver,
        resource,
        description:   "EvoYield evolved-strategy evaluation",
        mimeType:      "application/json",
        outputSchema:  null,
        maxTimeoutSeconds: 60,
        extra:         { nonce, decimals: DEFAULTS.decimals },
      },
    ],
  };
}

async function verifyWithFacilitator(payment, requirements) {
  const url = `${DEFAULTS.facilitator.replace(/\/+$/, "")}/verify`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ x402Version: 1, paymentPayload: payment, paymentRequirements: requirements.accepts[0] }),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`x402 facilitator verify failed (${res.status}): ${body}`);
  }
  const json = await res.json();
  if (!json.isValid) throw new Error(`x402 verification rejected: ${json.invalidReason ?? "unknown"}`);
  return json;
}

async function settleWithFacilitator(payment, requirements) {
  const url = `${DEFAULTS.facilitator.replace(/\/+$/, "")}/settle`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ x402Version: 1, paymentPayload: payment, paymentRequirements: requirements.accepts[0] }),
    signal:  AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`x402 facilitator settle failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Express middleware. If the request lacks a valid X-Payment header, responds
 * with 402 and the payment requirements. Otherwise, verifies (and optionally
 * settles) the payment, then calls next().
 *
 * Zero-config opt-out: if X402_RECEIVER is unset the middleware is a no-op,
 * so /evaluate continues to work for free during development.
 */
export function x402Required({ priceUsdc, description } = {}) {
  return async (req, res, next) => {
    if (!DEFAULTS.receiver) return next(); // not configured → free passthrough

    const resource = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const nonce    = randomUUID();
    const reqs     = paymentRequirements({ resource, nonce });

    // Allow per-route override of price/description
    if (priceUsdc != null) {
      const amount = BigInt(Math.round(priceUsdc * 10 ** DEFAULTS.decimals)).toString();
      reqs.accepts[0].maxAmountRequired = amount;
    }
    if (description) reqs.accepts[0].description = description;

    const header = req.header("x-payment");
    if (!header) {
      res.set("WWW-Authenticate", `x402 realm="${resource}"`);
      return res.status(402).json(reqs);
    }

    let payment;
    try {
      payment = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    } catch {
      return res.status(400).json({ error: "invalid X-Payment header (not base64 JSON)" });
    }

    try {
      if (DEFAULTS.verify && DEFAULTS.facilitator) {
        await verifyWithFacilitator(payment, reqs);
        const settle = await settleWithFacilitator(payment, reqs);
        res.set("X-Payment-Response", Buffer.from(JSON.stringify(settle)).toString("base64"));
      }
      // Attach the decoded payment to the request for downstream auditing.
      req.x402 = { payment, requirements: reqs };
      return next();
    } catch (err) {
      return res.status(402).json({ ...reqs, error: err.message });
    }
  };
}

export const x402Config = DEFAULTS;
