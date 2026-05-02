// Genome ↔ Workflow registry.
// Maps each evolved SkillGenome generation to the KeeperHub workflow ID that
// was synthesised for it, so we can: (a) skip re-synth when nothing changed,
// (b) decommission older generations after the new one proves healthy,
// (c) report the full lineage for the demo.
//
// Storage: .keeperhub-registry.json in the agent root, written atomically.

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readJson, writeJsonAtomic, withLock } from "./fs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(__dirname, "../../.keeperhub-registry.json");
const LOCK_KEY   = "kh-registry";

const EMPTY = {
  schemaVersion: 1,
  agent:         null,
  current:       null,           // { skillId, generation, workflowId, deployedAt }
  history:       [],             // entries: { skillId, generation, workflowId, deployedAt, retiredAt? }
  lastSyncedAt:  null,
};

export async function loadRegistry() {
  return readJson(STORE_PATH, EMPTY);
}

async function saveRegistry(reg) {
  reg.lastSyncedAt = new Date().toISOString();
  await writeJsonAtomic(STORE_PATH, reg);
}

/** Look up the workflow ID we previously synthesised for this skill+generation. */
export async function findWorkflowFor(skillId, generation) {
  const reg = await loadRegistry();
  if (reg.current?.skillId === skillId && reg.current?.generation === generation) {
    return reg.current.workflowId;
  }
  const hit = [...reg.history]
    .filter((e) => e.skillId === skillId && e.generation === generation)
    .sort((a, b) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime())[0];
  return hit?.workflowId ?? null;
}

/** Promote a freshly-deployed workflow to the "current" slot, retiring the previous one. */
export async function recordDeployment({ skillId, generation, workflowId, agent }) {
  return withLock(LOCK_KEY, async () => {
    const reg = await loadRegistry();
    const now = new Date().toISOString();

    if (reg.current && reg.current.workflowId !== workflowId) {
      // Mark previous current as retired in history
      const prev = reg.history.find((h) => h.workflowId === reg.current.workflowId);
      if (prev && !prev.retiredAt) prev.retiredAt = now;
    }

    // Upsert this entry into history
    let entry = reg.history.find((h) => h.workflowId === workflowId);
    if (!entry) {
      entry = { skillId, generation, workflowId, deployedAt: now };
      reg.history.push(entry);
    } else {
      entry.skillId    = skillId;
      entry.generation = generation;
      entry.deployedAt = entry.deployedAt ?? now;
      delete entry.retiredAt;
    }

    reg.current = { skillId, generation, workflowId, deployedAt: entry.deployedAt };
    if (agent) reg.agent = agent;

    await saveRegistry(reg);
    return reg.current;
  });
}

/** Return workflows that have been retired but might still need cleanup at KeeperHub. */
export async function listRetiredWorkflows({ keepLast = 1 } = {}) {
  const reg = await loadRegistry();
  const sorted = [...reg.history].sort(
    (a, b) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime(),
  );
  return sorted.slice(keepLast);
}

/** Mark a workflow as fully cleaned up (deleted from KeeperHub). */
export async function markCleanedUp(workflowId) {
  return withLock(LOCK_KEY, async () => {
    const reg = await loadRegistry();
    reg.history = reg.history.filter((h) => h.workflowId !== workflowId);
    if (reg.current?.workflowId === workflowId) reg.current = null;
    await saveRegistry(reg);
  });
}

/** Read-only snapshot for /status and the demo entry point. */
export async function snapshot() {
  const reg = await loadRegistry();
  return {
    agent:        reg.agent,
    current:      reg.current,
    historySize:  reg.history.length,
    lastSyncedAt: reg.lastSyncedAt,
  };
}
