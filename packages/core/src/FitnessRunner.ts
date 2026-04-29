/**
 * EvoFrame Core — FitnessRunner
 *
 * Evaluates SkillGenome candidates in a sandboxed Node.js vm context.
 * Returns BenchmarkResult[] for each test case run against the skill.
 */

import vm from "node:vm";
import { SkillGenome, BenchmarkResult, SkillExecutionContext } from "./types.js";

export interface FitnessTask {
  id: string;
  description: string;
  /** Input args passed to skill.execute() */
  input: Record<string, unknown>;
  /** Validator fn — receives the raw output and returns 0-100 score */
  validate: (output: unknown) => number;
  /** Timeout in ms for this task (default: 5000) */
  timeoutMs?: number;
}

export interface FitnessReport {
  skillId: string;
  overallScore: number; // 0-100 weighted average
  results: BenchmarkResult[];
  durationMs: number;
}

const SANDBOX_TIMEOUT_MS = 10_000;

/**
 * Wraps the skill's implementation string in an async function,
 * compiles it in a Node vm context, and runs the provided tasks.
 */
export class FitnessRunner {
  private readonly fitnessThreshold: number;

  constructor(fitnessThreshold = 70) {
    this.fitnessThreshold = fitnessThreshold;
  }

  async evaluate(
    genome: SkillGenome,
    tasks: FitnessTask[],
    executionContext: SkillExecutionContext,
  ): Promise<FitnessReport> {
    const startTime = Date.now();
    const results: BenchmarkResult[] = [];

    for (const task of tasks) {
      const result = await this.runTask(genome, task, executionContext);
      results.push(result);
    }

    const overallScore = this.computeOverallScore(results);

    return {
      skillId: genome.id,
      overallScore,
      results,
      durationMs: Date.now() - startTime,
    };
  }

  passes(report: FitnessReport): boolean {
    return report.overallScore >= this.fitnessThreshold;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async runTask(
    genome: SkillGenome,
    task: FitnessTask,
    executionContext: SkillExecutionContext,
  ): Promise<BenchmarkResult> {
    const taskStart = Date.now();
    const timeoutMs = task.timeoutMs ?? SANDBOX_TIMEOUT_MS;

    try {
      const output = await this.executeSandboxed(
        genome.implementation,
        task.input,
        executionContext,
        timeoutMs,
      );

      const qualityScore = task.validate(output);

      return {
        taskId: task.id,
        taskDescription: task.description,
        passed: qualityScore >= 50,
        latencyMs: Date.now() - taskStart,
        outputQualityScore: qualityScore,
        ranAt: Date.now(),
      };
    } catch (err) {
      return {
        taskId: task.id,
        taskDescription: task.description,
        passed: false,
        latencyMs: Date.now() - taskStart,
        outputQualityScore: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
        ranAt: Date.now(),
      };
    }
  }

  /**
   * Executes skill implementation in a Node.js `vm` sandbox.
   *
   * The implementation string must export (or return) an async function
   * with signature: (input, context) => Promise<unknown>
   *
   * Security notes:
   * - vm.runInNewContext with timeout prevents infinite loops
   * - No require/import available inside sandbox
   * - fetch is explicitly excluded
   */
  private async executeSandboxed(
    implementation: string,
    input: Record<string, unknown>,
    context: SkillExecutionContext,
    timeoutMs: number,
  ): Promise<unknown> {
    // Build a limited sandbox — no global access to fs, process, require
    const sandbox: Record<string, unknown> = {
      console: {
        log: () => {},
        error: () => {},
        warn: () => {},
      },
      JSON,
      Math,
      Date,
      setTimeout: undefined,
      setInterval: undefined,
      clearTimeout: undefined,
      clearInterval: undefined,
      process: undefined,
      require: undefined,
      __result: undefined as unknown,
      __error: undefined as unknown,
    };

    // Wrap implementation to capture the result
    const wrappedCode = `
(async () => {
  try {
    const __fn = (async function skillExecute(input, context) {
      ${implementation}
    });
    __result = await __fn(${JSON.stringify(input)}, ${JSON.stringify(context)});
  } catch (e) {
    __error = e && e.message ? e.message : String(e);
  }
})();
`;

    const script = new vm.Script(wrappedCode);
    const vmContext = vm.createContext(sandbox);

    await script.runInContext(vmContext, { timeout: timeoutMs });

    // Give the async function a moment to resolve
    await new Promise<void>((resolve) => {
      const check = () => {
        if (sandbox.__result !== undefined || sandbox.__error !== undefined) {
          resolve();
        } else {
          setImmediate(check);
        }
      };
      check();
    });

    if (sandbox.__error) {
      throw new Error(String(sandbox.__error));
    }

    return sandbox.__result;
  }

  private computeOverallScore(results: BenchmarkResult[]): number {
    if (results.length === 0) return 0;
    const total = results.reduce((sum, r) => sum + r.outputQualityScore, 0);
    return Math.round(total / results.length);
  }
}
