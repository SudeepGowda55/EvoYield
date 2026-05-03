// Express app — HTTP routes for the EvoYield agent API.
//
// Routes:
//   GET  /health      liveness check
//   GET  /status      current strategy + KeeperHub workflow snapshot
//   GET  /dashboard   latest rebalance run data (JSON) — consumed by the frontend
//   POST /evaluate    (x402-gated, optional) returns the evolved allocation
//   POST /regenerate  KeeperHub-callable hook to force re-evolution
//   GET  /workflow    inspect the current synthesised KeeperHub workflow

import express from "express";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import {
  initAgent,
  evaluate,
  getSkillInfo,
  forceRegenerate,
  getStorageAdapter,
} from "../agent/instance.mjs";
import { snapshot as khSnapshot } from "../keeperhub/registry.mjs";
import { x402Required }           from "../keeperhub/x402.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_JSON = resolve(__dirname, "../../../../apps/dashboard/public/data/latest-run.json");

export const app = express();
app.use(express.json({ limit: "1mb" }));

// Allow the dashboard frontend (any origin) to call this API directly.
// Next.js rewrites proxy /api/dashboard → here, so in practice this is
// only needed for direct curl / external access.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

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

// ── GET /dashboard ──────────────────────────────────────────────
// Serves the latest rebalance run data so the frontend can be deployed
// anywhere and stay live without sharing a filesystem with the agent.
// Priority: 0G Storage → local latest-run.json → 503
app.get("/dashboard", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");

  // 1. Try 0G Storage (rootHash is in .evoframe-cache.json hashIndex)
  const storage = getStorageAdapter();
  if (storage) {
    try {
      const blob = await storage.fetchBlob("dashboard:latest");
      if (blob) return res.json(JSON.parse(blob));
    } catch {
      // fall through to local file
    }
  }

  // 2. Fall back to local file (always written by dashboardData.mjs)
  if (!existsSync(DASHBOARD_JSON)) {
    return res.status(503).json({ error: "Dashboard data not yet available — run a KeeperHub cycle first." });
  }
  try {
    res.json(JSON.parse(readFileSync(DASHBOARD_JSON, "utf8")));
  } catch {
    res.status(500).json({ error: "Failed to read dashboard data." });
  }
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
      console.log("[/regenerate] completed — no candidate passed fitness threshold");
      return res.json({ regenerated: false, message: "no candidate passed fitness threshold" });
    }
    console.log(
      `[/regenerate] completed — promoted gen-${evolved.generation} ` +
      `fitness=${evolved.fitnessScore} skill=${evolved.id}`,
    );
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
