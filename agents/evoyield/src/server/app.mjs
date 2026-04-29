// Express app — all HTTP routes for the EvoYield agent API.
// KeeperHub calls POST /evaluate to get an allocation decision.

import express from "express";
import { initAgent, evaluate, getSkillInfo } from "../agent/instance.mjs";

export const app = express();
app.use(express.json());

// ── GET /health ─────────────────────────────────────────────────
// KeeperHub pings this to confirm the agent is reachable.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "EvoYield", timestamp: new Date().toISOString() });
});

// ── GET /status ─────────────────────────────────────────────────
// Returns current skill generation and fitness score.
app.get("/status", (_req, res) => {
  const skill = getSkillInfo();
  if (!skill) return res.status(503).json({ error: "Agent not initialized" });
  res.json({ skill });
});

// ── POST /evaluate ───────────────────────────────────────────────
// Body:    { aave_apy, morpho_apy, yearn_apy, sky_apy }  (numbers)
// Returns: { allocation: { aave, morpho, yearn, sky }, generation, fitnessScore }
app.post("/evaluate", async (req, res) => {
  const { aave_apy, morpho_apy, yearn_apy, sky_apy } = req.body ?? {};

  if ([aave_apy, morpho_apy, yearn_apy, sky_apy].some((v) => v == null)) {
    return res.status(400).json({
      error:    "Missing required fields",
      required: ["aave_apy", "morpho_apy", "yearn_apy", "sky_apy"],
    });
  }

  try {
    const result = await evaluate({ aave_apy, morpho_apy, yearn_apy, sky_apy });
    console.log(
      `[/evaluate] Aave=${aave_apy}% Morpho=${morpho_apy}% Yearn=${yearn_apy}% Sky=${sky_apy}%` +
      ` → ${JSON.stringify(result.allocation)}`
    );
    res.json(result);
  } catch (err) {
    console.error("[/evaluate] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export { initAgent };
