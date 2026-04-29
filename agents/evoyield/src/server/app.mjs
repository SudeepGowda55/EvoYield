// Express app — HTTP routes for the EvoYield agent API.
//
// Routes:
//   GET  /health      liveness check
//   GET  /status      current strategy + KeeperHub workflow snapshot
//   POST /evaluate    (x402-gated, optional) returns the evolved allocation
//   POST /regenerate  KeeperHub-callable hook to force re-evolution
//   GET  /workflow    inspect the current synthesised KeeperHub workflow

import express from "express";
import {
  initAgent,
  evaluate,
  getSkillInfo,
  forceRegenerate,
} from "../agent/instance.mjs";
import { snapshot as khSnapshot } from "../keeperhub/registry.mjs";
import { x402Required }           from "../keeperhub/x402.mjs";

export const app = express();
app.use(express.json({ limit: "1mb" }));

// ── GET /health ─────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "EvoYield", timestamp: new Date().toISOString() });
});

// ── GET /status ─────────────────────────────────────────────────
app.get("/status", async (_req, res) => {
  const skill = getSkillInfo();
  if (!skill) return res.status(503).json({ error: "Agent not initialized" });
  const kh = await khSnapshot().catch(() => null);
  res.json({ skill, keeperhub: kh });
});

// ── GET /workflow ───────────────────────────────────────────────
app.get("/workflow", async (_req, res) => {
  const kh = await khSnapshot();
  res.json(kh);
});

// ── POST /evaluate ──────────────────────────────────────────────
app.post("/evaluate", x402Required({ description: "EvoYield evolved-strategy evaluation" }), async (req, res) => {
  const { aave_apy, morpho_apy, yearn_apy, sky_apy } = req.body ?? {};
  if ([aave_apy, morpho_apy, yearn_apy, sky_apy].some((v) => v == null)) {
    return res.status(400).json({
      error:    "Missing required fields",
      required: ["aave_apy", "morpho_apy", "yearn_apy", "sky_apy"],
    });
  }
  try {
    const result = await evaluate({ aave_apy, morpho_apy, yearn_apy, sky_apy });
    if (req.x402) result.paid = true;
    console.log(
      `[/evaluate] APYs={${aave_apy},${morpho_apy},${yearn_apy},${sky_apy}}` +
      ` → ${JSON.stringify(result.allocation)}`,
    );
    res.json(result);
  } catch (err) {
    console.error("[/evaluate] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /regenerate ────────────────────────────────────────────
// Called by the synthesised KeeperHub workflow when it detects sustained
// underperformance (fitness drift, missed targets, repeated reverts).
// Body: { reason?, fitnessScore?, generation? }
app.post("/regenerate", async (req, res) => {
  const { reason, fitnessScore, generation } = req.body ?? {};
  console.log(
    `[/regenerate] requested by KeeperHub — reason="${reason ?? "n/a"}" ` +
    `fitness=${fitnessScore ?? "?"} gen=${generation ?? "?"}`,
  );
  try {
    const evolved = await forceRegenerate(reason ?? "KeeperHub regeneration trigger");
    if (!evolved) {
      return res.json({ regenerated: false, message: "no candidate passed fitness threshold" });
    }
    res.json({
      regenerated:  true,
      newSkillId:   evolved.id,
      newGeneration: evolved.generation,
      newFitness:   evolved.fitnessScore,
    });
  } catch (err) {
    console.error("[/regenerate] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export { initAgent };
