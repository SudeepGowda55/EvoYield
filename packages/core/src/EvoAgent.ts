/**
 * EvoFrame Core — EvoAgent
 *
 * Base class for all EvoFrame agents.
 * Provides skill management, execution, and automatic evolution triggering.
 * Designed as an OpenClaw-compatible module layer.
 */

import { randomUUID } from "node:crypto";
import {
  SkillGenome,
  SkillId,
  EvoFrameConfig,
  SkillExecutionContext,
  SkillExecutionResult,
  SkillDomain,
} from "./types.js";
import {
  EvolutionEngine,
  IStorageAdapter,
  IComputeAdapter,
  ISkillRegistryAdapter,
} from "./EvolutionEngine.js";
import { FitnessTask } from "./FitnessRunner.js";

export interface AgentTask {
  id: string;
  description: string;
  input: Record<string, unknown>;
  domain?: SkillDomain;
}

export interface AgentResult {
  taskId: string;
  success: boolean;
  output: unknown;
  usedSkillId: SkillId | null;
  evolved: boolean;
  newSkillId: SkillId | null;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// EvoAgent
// ---------------------------------------------------------------------------

export abstract class EvoAgent {
  protected readonly config: EvoFrameConfig;
  protected readonly engine: EvolutionEngine;
  protected readonly storage: IStorageAdapter;
  protected readonly registry: ISkillRegistryAdapter;

  /** Loaded skill genomes keyed by skill name */
  private skills: Map<string, SkillGenome> = new Map();

  constructor(
    config: EvoFrameConfig,
    storage: IStorageAdapter,
    compute: IComputeAdapter,
    registry: ISkillRegistryAdapter,
  ) {
    this.config = config;
    this.storage = storage;
    this.registry = registry;
    this.engine = new EvolutionEngine(config, storage, compute, registry);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize the agent:
   * 1. Load genesis skills defined in subclass
   * 2. Auto-evolve any skill whose current fitness is below threshold
   * 3. Poll SkillRegistry for top-performing inherited skills (pollination)
   */
  async initialize(): Promise<void> {
    const genesis = this.defineGenesisSkills();

    for (const genome of genesis) {
      // Look up by stable name-based key so we find evolved versions across restarts
      const stableKey = `skill-name:${this.config.agentName}:${genome.name}`;
      const stored = await this.storage.fetchGenome(stableKey);
      if (stored && stored.generation > 0) {
        // Use the evolved version from storage
        this.skills.set(stored.name, stored);
      } else {
        // No evolved version yet — register genesis
        this.skills.set(genome.name, genome);
        await this.storage.storeGenome(genome);
      }
    }

    // Auto-evolve any skill that doesn't pass current benchmarks
    await this.autoEvolveIfNeeded();

    // Cross-agent pollination: inherit top skills from registry
    await this.pollinate();

    this.onInitialized();
  }

  /**
   * Execute a task using the best available skill for the given domain.
   * Auto-triggers evolution if the skill fails.
   */
  async run(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    const skill = this.selectSkill(task);

    if (!skill) {
      return {
        taskId: task.id,
        success: false,
        output: null,
        usedSkillId: null,
        evolved: false,
        newSkillId: null,
        durationMs: Date.now() - start,
      };
    }

    const execCtx: SkillExecutionContext = {
      taskDescription: task.description,
      agentName: this.config.agentName,
      previousResults: [],
      memorySnapshot: {},
    };

    const result = await this.executeSkill(skill, task.input, execCtx);

    // Record execution and potentially trigger evolution
    const benchmarks = this.defineBenchmarksForSkill(skill);
    const evolvedGenome = await this.engine.recordExecution(
      result,
      skill,
      benchmarks,
      result.errorMessage,
    );

    if (evolvedGenome) {
      this.skills.set(evolvedGenome.name, evolvedGenome);
    }

    return {
      taskId: task.id,
      success: result.success,
      output: result.output,
      usedSkillId: skill.id,
      evolved: evolvedGenome !== null,
      newSkillId: evolvedGenome?.id ?? null,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Automatically evaluate loaded skills against their benchmarks and evolve
   * any that fall below the fitness threshold. Called during initialize().
   */
  private async autoEvolveIfNeeded(): Promise<void> {
    const fitnessRunner = new (await import("./FitnessRunner.js")).FitnessRunner(
      this.config.fitnessThreshold ?? 70,
    );
    const execCtx = {
      taskDescription: "benchmark evaluation",
      agentName: this.config.agentName,
      previousResults: [],
      memorySnapshot: {},
    };

    for (const [name, skill] of this.skills) {
      const benchmarks = this.defineBenchmarksForSkill(skill);
      if (benchmarks.length === 0) continue;

      const report = await fitnessRunner.evaluate(skill, benchmarks, execCtx);
      if (!fitnessRunner.passes(report)) {
        const hint = this.defineEvolveHint(skill);
        const evolved = await this.engine.evolve(
          {
            parentGenome: skill,
            failureReason: `Benchmark fitness ${report.overallScore} below threshold`,
            failedTaskDescription: `Failed benchmarks: ${report.results
              .filter((r) => !r.passed)
              .map((r) => r.taskId)
              .join(", ")}`,
            hint,
            agentAddress: this.config.agentName,
          },
          benchmarks,
        );
        if (evolved) {
          this.skills.set(name, evolved);
        }
      }
    }
  }

  /**
   * Manually trigger evolution for a specific skill.
   */
  async forceEvolve(skillName: string, reason: string, hint?: string): Promise<SkillGenome | null> {
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`Skill "${skillName}" not found`);

    const benchmarks = this.defineBenchmarksForSkill(skill);
    const evolved = await this.engine.evolve(
      {
        parentGenome: skill,
        failureReason: reason,
        failedTaskDescription: reason,
        hint,
        agentAddress: this.config.agentName,
      },
      benchmarks,
    );

    if (evolved) {
      this.skills.set(evolved.name, evolved);
    }

    return evolved;
  }

  /** List all currently loaded skills */
  listSkills(): SkillGenome[] {
    return Array.from(this.skills.values());
  }

  /** Get the evolution engine to subscribe to events */
  getEngine(): EvolutionEngine {
    return this.engine;
  }

  // ---------------------------------------------------------------------------
  // Abstract methods — subclasses must implement
  // ---------------------------------------------------------------------------

  /**
   * Return the initial set of skills the agent starts with (generation 0).
   */
  protected abstract defineGenesisSkills(): SkillGenome[];

  /**
   * Return benchmark tasks for evaluating mutations of a given skill.
   */
  protected abstract defineBenchmarksForSkill(skill: SkillGenome): FitnessTask[];

  // ---------------------------------------------------------------------------
  // Optional lifecycle hooks
  // ---------------------------------------------------------------------------

  /**
   * Return a hint string describing what a new evolved version of this skill
   * must do. Used automatically when the framework triggers evolution.
   * Override in subclass to avoid writing evolution logic in your main code.
   */
  protected defineEvolveHint(_skill: SkillGenome): string | undefined {
    return undefined;
  }

  protected onInitialized(): void {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private selectSkill(task: AgentTask): SkillGenome | null {
    const domain = task.domain;
    const candidates = Array.from(this.skills.values()).filter(
      (s) => s.status === "active" && (!domain || s.domain === domain),
    );
    if (candidates.length === 0) return null;
    // Pick highest fitness score
    return candidates.reduce((best, s) => (s.fitnessScore > best.fitnessScore ? s : best));
  }

  private async executeSkill(
    skill: SkillGenome,
    input: Record<string, unknown>,
    context: SkillExecutionContext,
  ): Promise<SkillExecutionResult> {
    const start = Date.now();
    try {
      // Dynamic import of sandboxed execution via FitnessRunner approach
      // For production use agents call skill implementations directly
      const fn = new Function(
        "input",
        "context",
        `return (async () => { ${skill.implementation} })()`,
      );
      const output = await fn(input, context);
      return {
        success: true,
        output,
        latencyMs: Date.now() - start,
        usedSkillId: skill.id,
      };
    } catch (err) {
      return {
        success: false,
        output: null,
        latencyMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
        usedSkillId: skill.id,
      };
    }
  }

  private async pollinate(): Promise<void> {
    const domains = new Set(Array.from(this.skills.values()).map((s) => s.domain));
    for (const domain of domains) {
      const inherited = await this.registry.getTopSkills(domain, 5);
      for (const genome of inherited) {
        // Only inherit if fitter than our current version
        const existing = this.skills.get(genome.name);
        if (!existing || genome.fitnessScore > existing.fitnessScore) {
          this.skills.set(genome.name, genome);
          this.engine["emit"]("pollination_received", genome.id, {
            from: genome.originAgent,
            domain,
          });
        }
      }
    }
  }

  /** Build a genesis genome helper — used by subclasses */
  protected buildGenesis(
    name: string,
    description: string,
    domain: SkillDomain,
    implementation: string,
    parameters: SkillGenome["parameters"] = [],
  ): SkillGenome {
    const id = randomUUID();
    return {
      id,
      name,
      description,
      domain,
      version: "1.0.0",
      implementation,
      parameters,
      outputDescription: "Result of " + name,
      parentId: null,
      generation: 0,
      originAgent: this.config.agentName,
      parentStorageHash: null,
      fitnessScore: 60, // default genesis fitness
      usageCount: 0,
      failureCount: 0,
      benchmarkResults: [],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      storageKey: `skill:${id}`,
      sealedInferenceAttestation: null,
      onChainTxHash: null,
    };
  }
}
