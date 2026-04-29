/**
 * agent.ts — ResearchEvolver agent definition
 *
 * This is where YOU define:
 *   1. Genesis skills  — the starting (dumb) implementations
 *   2. Benchmarks      — what "good output" looks like for each skill
 *
 * EvoFrame handles everything else:
 *   - detecting failures
 *   - calling 0G Compute for mutations
 *   - evaluating candidates in a sandbox
 *   - promoting winners and storing them on 0G Storage
 */

import { EvoAgent, SkillGenome } from "@evoframe/core";
import type { FitnessTask } from "@evoframe/core";
import {
  KEYWORD_EXTRACTOR_BENCHMARKS,
  RESEARCH_SUMMARIZER_BENCHMARKS,
  CITATION_EXTRACTOR_BENCHMARKS,
  CODE_REVIEWER_BENCHMARKS,
  DEFAULT_BENCHMARKS,
} from "./benchmarks.js";

export class ResearchEvolver extends EvoAgent {
  // ---------------------------------------------------------------------------
  // Step 1: Define genesis skills
  // These are intentionally naive — they WILL fail benchmarks on purpose.
  // That failure is what triggers the 0G Compute evolution loop.
  // ---------------------------------------------------------------------------
  protected defineGenesisSkills(): SkillGenome[] {
    return [
      // -- Research skills --

      this.buildGenesis(
        "keyword-extractor",
        "Extracts key terms from a research text",
        "research",
        `
const text = String(input.text ?? "");
if (!text) return { keywords: [], confidence: 0 };
// Naive: returns unique words > 5 chars, no stop-word filtering
const words = text.toLowerCase().split(/\\W+/);
const keywords = [...new Set(words.filter(w => w.length > 5))].slice(0, 10);
return { keywords, confidence: 0.4 };
        `.trim(),
        [{ name: "text", type: "string", description: "Research text to analyze", required: true }],
      ),

      this.buildGenesis(
        "research-summarizer",
        "Produces a structured research summary from text",
        "research",
        `
const text = String(input.text ?? "");
if (!text) return { summary: "", keyFindings: [], wordCount: 0 };
// Naive: takes first 2 sentences, returns empty keyFindings
const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
const summary = sentences.slice(0, 2).join(". ") + ".";
return { summary, keyFindings: [], wordCount: text.split(" ").length };
        `.trim(),
        [
          {
            name: "text",
            type: "string",
            description: "Research text to summarize",
            required: true,
          },
        ],
      ),

      this.buildGenesis(
        "citation-extractor",
        "Identifies and formats academic citations from text",
        "research",
        `
const text = String(input.text ?? "");
// Naive: only matches (Author, Year) pattern — misses many citation styles
const pattern = /\\(([A-Z][a-z]+(?:\\s+et\\s+al\\.)?),\\s*(\\d{4})\\)/g;
const citations = [];
let match;
while ((match = pattern.exec(text)) !== null) {
  citations.push({ author: match[1], year: match[2] });
}
return { citations, count: citations.length };
        `.trim(),
        [
          {
            name: "text",
            type: "string",
            description: "Academic text to scan for citations",
            required: true,
          },
        ],
      ),

      // -- Developer skill --

      this.buildGenesis(
        "code-reviewer",
        "Reviews JavaScript/TypeScript code for bugs and security issues",
        "coding",
        `
const code = String(input.code ?? "");
if (!code) return { issues: [], score: 100, issueCount: 0, summary: "No code to analyze" };
const issues = [];
// Naive: only finds console.log — misses SQL injection, missing await, etc.
const logMatches = code.match(/console\\.log/g) ?? [];
if (logMatches.length > 0) {
  issues.push({ type: "debug-log", severity: "low", count: logMatches.length, fix: "Remove console.log" });
}
return { issues, score: 100 - issues.length * 5, issueCount: issues.length, summary: issues.length === 0 ? "Looks clean" : "Found " + issues.length + " issue(s)" };
        `.trim(),
        [
          {
            name: "code",
            type: "string",
            description: "JavaScript or TypeScript source code to review",
            required: true,
          },
        ],
      ),
    ];
  }

  // ---------------------------------------------------------------------------
  // Step 2: Define benchmarks for each skill
  // These are the fitness tests that evolved candidates must pass.
  // A candidate scores 0-100 per test. Average must exceed fitnessThreshold.
  // ---------------------------------------------------------------------------
  protected defineBenchmarksForSkill(skill: SkillGenome): FitnessTask[] {
    const benchmarkMap: Record<string, FitnessTask[]> = {
      "keyword-extractor": KEYWORD_EXTRACTOR_BENCHMARKS,
      "research-summarizer": RESEARCH_SUMMARIZER_BENCHMARKS,
      "citation-extractor": CITATION_EXTRACTOR_BENCHMARKS,
      "code-reviewer": CODE_REVIEWER_BENCHMARKS,
    };
    return benchmarkMap[skill.name] ?? DEFAULT_BENCHMARKS;
  }
}
