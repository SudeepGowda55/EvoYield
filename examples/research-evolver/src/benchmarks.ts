/**
 * benchmarks.ts — Fitness test definitions
 *
 * Each FitnessTask defines:
 *   - input:    what gets passed to the skill
 *   - validate: a scoring function (0-100) that judges the output
 *
 * When EvoFrame generates a mutation candidate via 0G Compute, it runs it
 * through ALL these tasks in a sandboxed vm. Only candidates with an
 * average score above fitnessThreshold get promoted.
 *
 * To add your own tests: just add entries to the relevant array below.
 */

import type { FitnessTask } from "@evoframe/core";

// ---------------------------------------------------------------------------
// Sample text used as input for research skill tests
// ---------------------------------------------------------------------------

export const RESEARCH_TEXT = `
Transformer-based large language models have demonstrated remarkable capabilities
in natural language understanding and generation tasks (Vaswani et al., 2017;
Brown et al., 2020). Recent advances in reinforcement learning from human feedback
(RLHF) have further improved the alignment of these models with human preferences
(Ouyang et al., 2022). However, challenges remain in areas such as hallucination
reduction, multi-step reasoning, and computational efficiency. Researchers have
proposed various approaches to address these limitations, including chain-of-thought
prompting (Wei et al., 2022), retrieval-augmented generation (Lewis et al., 2020),
and mixture-of-experts architectures (Fedus et al., 2022).
`.trim();

// ---------------------------------------------------------------------------
// Keyword extractor benchmarks
// ---------------------------------------------------------------------------

export const KEYWORD_EXTRACTOR_BENCHMARKS: FitnessTask[] = [
  {
    id: "keyword-basic",
    description: "Extract meaningful keywords from ML research text",
    input: { text: RESEARCH_TEXT },
    validate: (output) => {
      const o = output as { keywords: string[]; confidence: number };
      if (!o?.keywords || !Array.isArray(o.keywords)) return 0;
      const expected = ["transformer", "language", "reinforcement", "learning"];
      const found = expected.filter((kw) =>
        o.keywords.some((k) => k.toLowerCase().includes(kw)),
      ).length;
      return Math.max(Math.round((found / expected.length) * 100), o.keywords.length >= 5 ? 40 : 0);
    },
    timeoutMs: 3000,
  },
  {
    id: "keyword-confidence",
    description: "Confidence score should be > 0.6",
    input: { text: RESEARCH_TEXT },
    validate: (output) => {
      const o = output as { confidence: number };
      return (o?.confidence ?? 0) > 0.6 ? 100 : 30;
    },
  },
  {
    id: "keyword-empty",
    description: "Empty input returns empty keywords array",
    input: { text: "" },
    validate: (output) => {
      const o = output as { keywords: string[] };
      return Array.isArray(o?.keywords) && o.keywords.length === 0 ? 100 : 0;
    },
  },
];

// ---------------------------------------------------------------------------
// Research summarizer benchmarks
// ---------------------------------------------------------------------------

export const RESEARCH_SUMMARIZER_BENCHMARKS: FitnessTask[] = [
  {
    id: "summarize-structure",
    description: "Must return keyFindings array with at least 2 items",
    input: { text: RESEARCH_TEXT },
    validate: (output) => {
      const o = output as { keyFindings: string[] };
      if (!Array.isArray(o?.keyFindings)) return 0;
      return o.keyFindings.length >= 2 ? 100 : 20;
    },
  },
  {
    id: "summarize-quality",
    description: "Summary should be 20-200 words",
    input: { text: RESEARCH_TEXT },
    validate: (output) => {
      const o = output as { summary: string };
      const wc = (o?.summary ?? "").split(" ").length;
      return wc >= 20 && wc <= 200 ? 100 : wc > 0 ? 40 : 0;
    },
  },
  {
    id: "summarize-techniques",
    description: "Should mention key techniques (RLHF, transformer, etc.)",
    input: { text: RESEARCH_TEXT },
    validate: (output) => {
      const o = output as { summary: string; keyFindings: string[] };
      const allText = [o?.summary, ...(o?.keyFindings ?? [])].join(" ").toLowerCase();
      const techniques = ["rlhf", "transformer", "retrieval", "chain-of-thought", "reasoning"];
      const found = techniques.filter((t) => allText.includes(t)).length;
      return Math.round((found / techniques.length) * 100);
    },
  },
];

// ---------------------------------------------------------------------------
// Citation extractor benchmarks
// ---------------------------------------------------------------------------

export const CITATION_EXTRACTOR_BENCHMARKS: FitnessTask[] = [
  {
    id: "citation-count",
    description: "Must find at least 4 citations",
    input: { text: RESEARCH_TEXT },
    validate: (output) => {
      const o = output as { count: number };
      return (o?.count ?? 0) >= 4 ? 100 : Math.round(((o?.count ?? 0) / 4) * 60);
    },
  },
  {
    id: "citation-format",
    description: "Each citation must have author and year",
    input: { text: RESEARCH_TEXT },
    validate: (output) => {
      const o = output as { citations: Array<{ author: string; year: string }> };
      if (!o?.citations?.length) return 0;
      const valid = o.citations.filter((c) => c.author && c.year).length;
      return Math.round((valid / o.citations.length) * 100);
    },
  },
];

// ---------------------------------------------------------------------------
// Code reviewer benchmarks
// Buggy code snippets a real developer might write
// ---------------------------------------------------------------------------

// Bug: SQL injection via string concatenation
export const BUGGY_CODE_SQL = `
async function getUser(db, username) {
  const result = await db.query("SELECT * FROM users WHERE name = '" + username + "'");
  return result.rows[0];
}
`.trim();

// Bug: response.json() called without await + var + console.log
export const BUGGY_CODE_MISSING_AWAIT = `
async function fetchUserData(userId) {
  var response = await fetch('/api/users/' + userId);
  var data = response.json();  // missing await!
  console.log('fetched:', data);
  return data;
}
`.trim();

// Bug: async function with no try-catch
export const BUGGY_CODE_NO_TRY_CATCH = `
async function deletePost(postId) {
  const response = await fetch('/api/posts/' + postId, { method: 'DELETE' });
  const result = await response.json();
  return result.deleted;
}
`.trim();

// Bug: stateful regex with `g` flag — silently drops valid values on repeated .test() calls
// This is a subtle JS gotcha: regex with /g maintains lastIndex between calls,
// so filter() calls .test() multiple times and alternating items get skipped.
export const BUGGY_CODE_STATEFUL_REGEX = `
const EMAIL_REGEX = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/g;

function isValidEmail(email) {
  return EMAIL_REGEX.test(email);
}

function filterValidEmails(emails) {
  return emails.filter(isValidEmail);
}

const userEmails = [
  "alice@company.com",
  "bob@company.com",
  "charlie@company.com",
  "not-an-email",
  "dave@company.com",
];

console.log(filterValidEmails(userEmails));
// Expected: all 4 valid emails
// Actual:   bob is silently dropped — the \`g\` flag makes regex stateful!
`.trim();

// Clean code — evolved skill must NOT flag this
const CLEAN_CODE = `
async function fetchUser(userId: string): Promise<User> {
  try {
    const response = await fetch(\`/api/users/\${encodeURIComponent(userId)}\`);
    if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
    return await response.json() as User;
  } catch (err) {
    throw new Error(\`Failed to fetch user: \${err instanceof Error ? err.message : String(err)}\`);
  }
}
`.trim();

export const CODE_REVIEWER_BENCHMARKS: FitnessTask[] = [
  {
    id: "detect-sql-injection",
    description: "Must detect SQL injection via string concatenation",
    input: { code: BUGGY_CODE_SQL },
    validate: (output) => {
      const o = output as { issues: Array<Record<string, unknown>>; score: number };
      const found = o?.issues?.some((issue) => {
        const text = Object.values(issue)
          .filter((v) => typeof v === "string")
          .join(" ")
          .toLowerCase();
        return text.includes("sql") || text.includes("injection") || text.includes("concatenat");
      });
      return found ? 100 : (o?.score ?? 100) < 70 ? 50 : 0;
    },
    timeoutMs: 3000,
  },
  {
    id: "detect-missing-await",
    description: "Must detect response.json() without await",
    input: { code: BUGGY_CODE_MISSING_AWAIT },
    validate: (output) => {
      const o = output as { issues: Array<Record<string, unknown>> };
      const found = o?.issues?.some((issue) => {
        const text = Object.values(issue)
          .filter((v) => typeof v === "string")
          .join(" ")
          .toLowerCase();
        return text.includes("await") || text.includes("json()") || text.includes("promise");
      });
      return found ? 100 : 0;
    },
  },
  {
    id: "detect-missing-error-handling",
    description: "Must detect async function without try-catch",
    input: { code: BUGGY_CODE_NO_TRY_CATCH },
    validate: (output) => {
      const o = output as { issues: Array<Record<string, unknown>> };
      const found = o?.issues?.some((issue) => {
        const text = Object.values(issue)
          .filter((v) => typeof v === "string")
          .join(" ")
          .toLowerCase();
        return (
          text.includes("try") ||
          text.includes("catch") ||
          text.includes("error") ||
          text.includes("handling")
        );
      });
      return found ? 100 : 0;
    },
  },
  {
    id: "no-false-positives",
    description: "Clean code must not trigger critical/high alerts",
    input: { code: CLEAN_CODE },
    validate: (output) => {
      const o = output as { score: number; issues: Array<Record<string, unknown>> };
      const falseAlarms = (o?.issues ?? []).filter((issue) => {
        const severity = String(issue["severity"] ?? issue["level"] ?? "").toLowerCase();
        return severity === "critical" || severity === "high";
      }).length;
      if (falseAlarms > 0) return 0;
      return (o?.score ?? 0) >= 75 ? 100 : 40;
    },
  },
  {
    id: "detect-empty-code",
    description: "Empty input returns zero issues",
    input: { code: "" },
    validate: (output) => {
      const o = output as { issueCount?: number; issues?: unknown[] };
      return (o?.issueCount ?? o?.issues?.length ?? 0) === 0 ? 100 : 0;
    },
  },
  {
    id: "detect-stateful-regex",
    description: "Must detect /g flag on regex used with .test() in a filter",
    input: { code: BUGGY_CODE_STATEFUL_REGEX },
    validate: (output) => {
      const o = output as { issues: Array<Record<string, unknown>> };
      const found = o?.issues?.some((issue) => {
        const text = Object.values(issue)
          .filter((v) => typeof v === "string")
          .join(" ")
          .toLowerCase();
        return (
          text.includes("/g") ||
          text.includes("global") ||
          text.includes("lastindex") ||
          text.includes("stateful") ||
          text.includes("regex flag") ||
          (text.includes("regex") && text.includes("flag")) ||
          (text.includes("regex") && text.includes("state"))
        );
      });
      return found ? 100 : 0;
    },
  },
];

// ---------------------------------------------------------------------------
// Fallback — used for skills without specific benchmarks
// ---------------------------------------------------------------------------

export const DEFAULT_BENCHMARKS: FitnessTask[] = [
  {
    id: "basic-execution",
    description: "Skill executes without error",
    input: { text: RESEARCH_TEXT },
    validate: (output) => (output !== null && output !== undefined ? 70 : 0),
  },
];
