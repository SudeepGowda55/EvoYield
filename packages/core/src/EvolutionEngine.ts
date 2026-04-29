/**
 * EvoFrame Core — EvolutionEngine
 *
 * Orchestrates the full evolution loop:
 *   detect failure → call 0G Compute for mutations → run FitnessRunner
 *   → promote winners → persist to 0G Storage → register on-chain
 */

import { randomUUID } from "node:crypto";
import {
  SkillGenome,
  SkillId,
  MutationContext,
  EvolutionEvent,
  EvolutionEventType,
  BenchmarkResult,
  EvoFrameConfig,
  SkillExecutionResult,
} from "./types.js";
import { FitnessRunner, FitnessTask, FitnessReport } from "./FitnessRunner.js";

// ---------------------------------------------------------------------------
// Interfaces for injected adapters (dependency-injected to avoid tight coupling)
// ---------------------------------------------------------------------------

export interface IStorageAdapter {
  storeGenome(genome: SkillGenome): Promise<string>; // returns storage hash
  fetchGenome(storageKey: string): Promise<SkillGenome | null>;
  appendLineageEntry(entry: LineageEntry): Promise<void>;
  listActiveSkillKeys(domain?: string): Promise<string[]>;
}

export interface IComputeAdapter {
  generateMutations(
    ctx: MutationContext,
    count: number,
    model: string,
  ): Promise<MutationCandidate[]>;
}

export interface ISkillRegistryAdapter {
  register(genome: SkillGenome): Promise<string>; // returns tx hash
  getTopSkills(domain: string, limit: number): Promise<SkillGenome[]>;
  recordUsage(skillId: SkillId, agentAddress: string): Promise<void>;
}

export interface MutationCandidate {
  implementation: string;
  rationale: string;
  attestation: string; // sealed inference proof
}

export interface LineageEntry {
  skillId: SkillId;
  parentId: SkillId | null;
  generation: number;
  fitnessScore: number;
  timestamp: number;
  agentAddress: string;
  storageHash: string;
}

// ---------------------------------------------------------------------------
// EvolutionEngine
// ---------------------------------------------------------------------------

export type EvolutionEventHandler = (event: EvolutionEvent) => void;

export class EvolutionEngine {
  private readonly config: EvoFrameConfig;
  private readonly storage: IStorageAdapter;
  private readonly compute: IComputeAdapter;
  private readonly registry: ISkillRegistryAdapter;
  private readonly fitnessRunner: FitnessRunner;
  private readonly eventHandlers: EvolutionEventHandler[] = [];

  constructor(
    config: EvoFrameConfig,
    storage: IStorageAdapter,
    compute: IComputeAdapter,
    registry: ISkillRegistryAdapter,
  ) {
    this.config = config;
    this.storage = storage;
    this.compute = compute;
    this.registry = registry;
    this.fitnessRunner = new FitnessRunner(config.fitnessThreshold ?? 70);
  }

  /** Subscribe to evolution lifecycle events */
  on(handler: EvolutionEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Main entry point: triggered when an agent skill fails a task.
   *
   * Returns the promoted genome (or null if all candidates failed).
   */
  async evolve(
    mutationContext: MutationContext,
    benchmarkTasks: FitnessTask[],
  ): Promise<SkillGenome | null> {
    this.emit("mutation_requested", mutationContext.parentGenome.id, {
      failureReason: mutationContext.failureReason,
      parentId: mutationContext.parentGenome.id,
      generation: mutationContext.parentGenome.generation + 1,
    });

    // 1. Generate mutation candidates via 0G Compute sealed inference
    const candidateCount = this.config.maxCandidatesPerCycle ?? 3;
    const model = this.config.evolutionModel ?? "qwen3.6-plus";

    const mutations = await this.compute.generateMutations(mutationContext, candidateCount, model);

    const candidates: SkillGenome[] = mutations.map((m) =>
      this.buildCandidateGenome(mutationContext, m),
    );

    for (const candidate of candidates) {
      this.emit("candidate_generated", candidate.id, {
        parentId: candidate.parentId,
        generation: candidate.generation,
        rationale: mutations.find((m) => m.attestation === candidate.sealedInferenceAttestation)
          ?.rationale,
      });
    }

    // 2. Run fitness evaluation on each candidate
    let bestReport: FitnessReport | null = null;
    let bestCandidate: SkillGenome | null = null;

    const executionCtx = {
      taskDescription: mutationContext.failedTaskDescription,
      agentName: this.config.agentName,
      previousResults: [],
      memorySnapshot: {},
    };

    for (const candidate of candidates) {
      this.emit("fitness_evaluation_started", candidate.id, {});

      const report = await this.fitnessRunner.evaluate(candidate, benchmarkTasks, executionCtx);

      this.emit("fitness_evaluation_completed", candidate.id, {
        score: report.overallScore,
        passed: this.fitnessRunner.passes(report),
        results: report.results,
      });

      if (
        this.fitnessRunner.passes(report) &&
        (bestReport === null || report.overallScore > bestReport.overallScore)
      ) {
        bestReport = report;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate || !bestReport) {
      // All candidates rejected
      for (const candidate of candidates) {
        this.emit("skill_rejected", candidate.id, {
          reason: "fitness_below_threshold",
        });
      }
      return null;
    }

    // 3. Promote best candidate
    const promoted: SkillGenome = {
      ...bestCandidate,
      status: "active",
      fitnessScore: bestReport.overallScore,
      benchmarkResults: bestReport.results,
      updatedAt: Date.now(),
      version: this.bumpVersion(mutationContext.parentGenome.version),
    };

    // Retire parent
    const retiredParent: SkillGenome = {
      ...mutationContext.parentGenome,
      status: "retired",
      updatedAt: Date.now(),
    };

    // 4. Persist to 0G Storage
    const storageHash = await this.storage.storeGenome(promoted);
    await this.storage.storeGenome(retiredParent);

    // Also store under stable name-based key so agent can reload across restarts
    const stableNameGenome = {
      ...promoted,
      storageKey: `skill-name:${this.config.agentName}:${promoted.name}`,
    };
    await this.storage.storeGenome(stableNameGenome);

    const lineageEntry: LineageEntry = {
      skillId: promoted.id,
      parentId: promoted.parentId,
      generation: promoted.generation,
      fitnessScore: promoted.fitnessScore,
      timestamp: Date.now(),
      agentAddress: this.config.agentPrivateKey, // address derived at runtime
      storageHash,
    };
    await this.storage.appendLineageEntry(lineageEntry);

    this.emit("skill_promoted", promoted.id, {
      storageHash,
      fitnessScore: promoted.fitnessScore,
      generation: promoted.generation,
    });

    // 5. Register on-chain if configured
    if (this.config.autoRegisterOnChain !== false) {
      const txHash = await this.registry.register(promoted);
      promoted.onChainTxHash = txHash;

      this.emit("skill_registered_onchain", promoted.id, { txHash });
    }

    return promoted;
  }

  /**
   * Records a successful skill execution — updates usage counters
   * and triggers evolution if failure rate crosses threshold.
   */
  async recordExecution(
    result: SkillExecutionResult,
    genome: SkillGenome,
    benchmarkTasks: FitnessTask[],
    failureReason?: string,
  ): Promise<SkillGenome | null> {
    const updated: SkillGenome = {
      ...genome,
      usageCount: genome.usageCount + (result.success ? 1 : 0),
      failureCount: genome.failureCount + (result.success ? 0 : 1),
      updatedAt: Date.now(),
    };

    await this.storage.storeGenome(updated);
    await this.registry.recordUsage(genome.id, this.config.agentName);

    // Auto-evolve if failure rate exceeds 30%
    const totalRuns = updated.usageCount + updated.failureCount;
    const failureRate = totalRuns > 0 ? updated.failureCount / totalRuns : 0;

    if (!result.success && failureRate >= 0.3 && totalRuns >= 3) {
      const ctx: MutationContext = {
        parentGenome: updated,
        failureReason: failureReason ?? result.errorMessage ?? "Unknown failure",
        failedTaskDescription: result.errorMessage ?? "Task execution failed",
        hint: failureReason,
        agentAddress: this.config.agentName,
      };
      return this.evolve(ctx, benchmarkTasks);
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildCandidateGenome(ctx: MutationContext, candidate: MutationCandidate): SkillGenome {
    const id = randomUUID();
    const parentGenome = ctx.parentGenome;

    return {
      id,
      name: parentGenome.name,
      description: parentGenome.description,
      domain: parentGenome.domain,
      version: `${parentGenome.generation + 1}.0.0-candidate`,
      implementation: candidate.implementation,
      parameters: parentGenome.parameters,
      outputDescription: parentGenome.outputDescription,
      parentId: parentGenome.id,
      generation: parentGenome.generation + 1,
      originAgent: ctx.agentAddress,
      parentStorageHash: parentGenome.storageKey,
      fitnessScore: 0,
      usageCount: 0,
      failureCount: 0,
      benchmarkResults: [] as BenchmarkResult[],
      status: "candidate",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      storageKey: `skill:${id}`,
      sealedInferenceAttestation: candidate.attestation,
      onChainTxHash: null,
    };
  }

  private bumpVersion(current: string): string {
    const parts = current.replace(/-.*$/, "").split(".").map(Number);
    return `${(parts[0] ?? 0) + 1}.0.0`;
  }

  private emit(type: EvolutionEventType, skillId: SkillId, data: Record<string, unknown>): void {
    const event: EvolutionEvent = { type, skillId, timestamp: Date.now(), data };
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }
}
