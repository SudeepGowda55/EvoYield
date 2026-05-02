/**
 * @evoframe/0g-adapter — ComputeAdapter
 *
 * Implements IComputeAdapter against 0G Compute Network.
 *
 * 0G Compute provides trustless, sealed AI inference:
 *   - Cryptographic attestation of which model + weights produced the output
 *   - TEE-backed isolation for prompt privacy
 *   - Supports: qwen3.6-plus, GLM-5-FP8, and other models on the network
 *
 * API reference: https://docs.0g.ai/developer-hub/building-on-0g/compute-network
 *
 * Operational modes:
 *   "live"     — real 0G Compute Network endpoint
 *   "openai"   — OpenAI-compatible fallback (for dev without 0G node)
 *   "local"    — mocked responses (for unit tests / CI)
 */

import { MutationContext, MutationCandidate, IComputeAdapter } from "@evoframe/core";

export type ComputeMode = "live" | "openai" | "local";

export interface ComputeAdapterConfig {
  mode: ComputeMode;
  /** 0G Compute endpoint — required for "live" mode */
  computeEndpoint?: string;
  /** API key for 0G Compute or OpenAI */
  apiKey?: string;
  /** OpenAI-compatible base URL for "openai" mode */
  openAiBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// 0G Compute sealed inference response shape
// ---------------------------------------------------------------------------

interface ZgComputeResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  /** Sealed inference attestation (TEE proof) */
  attestation?: {
    model: string;
    inputHash: string;
    outputHash: string;
    signature: string;
    timestamp: number;
  };
}

// ---------------------------------------------------------------------------
// ComputeAdapter
// ---------------------------------------------------------------------------

export class ComputeAdapter implements IComputeAdapter {
  private readonly config: ComputeAdapterConfig;

  constructor(config: ComputeAdapterConfig) {
    this.config = config;
  }

  async generateMutations(
    ctx: MutationContext,
    count: number,
    model: string,
  ): Promise<MutationCandidate[]> {
    const prompt = this.buildMutationPrompt(ctx, count);

    switch (this.config.mode) {
      case "live":
        return this.callZgCompute(prompt, model, count);
      case "openai":
        return this.callOpenAiCompat(prompt, model, count);
      case "local":
        return this.mockMutations(ctx, count);
    }
  }

  // ---------------------------------------------------------------------------
  // 0G Compute Network (live sealed inference)
  // ---------------------------------------------------------------------------

  private async callZgCompute(
    prompt: string,
    model: string,
    count: number,
  ): Promise<MutationCandidate[]> {
    if (!this.config.computeEndpoint || !this.config.apiKey) {
      throw new Error("0G Compute: computeEndpoint and apiKey are required");
    }

    // 0G Compute proxy path — different from standard OpenAI path
    const url = `${this.config.computeEndpoint}/v1/proxy/chat/completions`;

    // 0G Compute doesn't support n>1; make sequential calls for multiple candidates.
    // Rate limit: 10 req/min → wait 7s between calls to stay safe.
    const candidates: MutationCandidate[] = [];
    for (let i = 0; i < count; i++) {
      if (i > 0) {
        // Stay well within 10 req/min limit
        await new Promise<void>((r) => setTimeout(r, 7000));
      }

      // Log the outgoing 0G Compute request
      try {
        console.log(
          `  🔗 0G Compute request — model=${model} attempt=${i + 1}/${count} promptLen=${
            String(prompt).length
          }`,
        );
      } catch {
        // best-effort logging — don't fail the request if logging breaks
      }

      const response = await this.zgFetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: EVOLUTION_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          temperature: 0.7 + i * 0.1, // vary temperature for diversity
          max_tokens: 2048,
        }),
      });

      const data = (await response.json()) as ZgComputeResponse;
      const parsed = this.parseComputeResponse(data, 1);
      if (parsed[0]) candidates.push(parsed[0]);
    }

    return candidates;
  }

  /**
   * Wraps fetch with automatic retry on 429 (rate limit).
   * Waits for the Retry-After header duration (or 65s default) then retries once.
   */
  private async zgFetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const response = await fetch(url, init);
    if (response.status !== 429) return response;

    const retryAfter = Number(response.headers.get("Retry-After") ?? "65");
    const waitMs = Math.max(retryAfter * 1000, 65_000);
    console.log(`  ⏳ Rate limit hit — waiting ${Math.round(waitMs / 1000)}s before retry...`);
    await new Promise<void>((r) => setTimeout(r, waitMs));

    const retried = await fetch(url, init);
    if (!retried.ok) {
      const errText = await retried.text().catch(() => "");
      throw new Error(
        `0G Compute request failed: ${retried.status} ${retried.statusText} — ${errText}`,
      );
    }
    return retried;
  }

  // ---------------------------------------------------------------------------
  // OpenAI-compatible fallback
  // ---------------------------------------------------------------------------

  private async callOpenAiCompat(
    prompt: string,
    model: string,
    count: number,
  ): Promise<MutationCandidate[]> {
    const baseUrl = this.config.openAiBaseUrl ?? "https://api.openai.com";
    if (!this.config.apiKey) throw new Error("OpenAI API key required");

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: model === "qwen3.6-plus" ? "gpt-4o" : model,
        messages: [
          { role: "system", content: EVOLUTION_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status}`);
    }

    const data = (await response.json()) as ZgComputeResponse;
    return this.parseComputeResponse(data, count);
  }

  // ---------------------------------------------------------------------------
  // Mock for local/CI mode — generates real working implementations per skill
  // ---------------------------------------------------------------------------

  private mockMutations(ctx: MutationContext, count: number): MutationCandidate[] {
    const impls = this.getMockImplementations(ctx.parentGenome.name, count);
    return impls.map((impl, i) => ({
      implementation: impl,
      rationale: `Mock mutation ${i + 1}: improved "${ctx.parentGenome.name}" — fixes: ${ctx.failureReason}`,
      attestation: `mock-sealed-attestation-${Date.now()}-${i}`,
    }));
  }

  /**
   * Returns skill-specific improved implementations for local/demo mode.
   * These simulate what 0G Compute sealed inference would return.
   */
  private getMockImplementations(skillName: string, count: number): string[] {
    const variants: Record<string, string[]> = {
      "keyword-extractor": [
        `
// Gen-1 mutation: TF-IDF-inspired extraction with confidence scoring
const text = String(input.text ?? "");
if (!text) return { keywords: [], confidence: 0 };
const stopWords = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","with","by","from","is","are","was","were","be","been","have","has","had","do","does","did","will","would","could","should","may","might","that","this","these","those","it","its","they","their","there","here","not","also","just","more","some","such","than","then","when","where","which","while"]);
const words = text.toLowerCase().replace(/[^a-z0-9\\s-]/g, " ").split(/\\s+/).filter(Boolean);
const freq: Record<string, number> = {};
for (const w of words) { if (!stopWords.has(w) && w.length > 3) freq[w] = (freq[w] ?? 0) + 1; }
const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15);
const topFreq = sorted[0]?.[1] ?? 1;
const keywords = sorted.map(([w]) => w);
const confidence = Math.min(0.95, 0.5 + (sorted.length / 20));
return { keywords, confidence };
        `.trim(),
        `
// Gen-1 mutation: n-gram extraction with domain awareness
const text = String(input.text ?? "");
if (!text) return { keywords: [], confidence: 0 };
const stopWords = new Set(["the","a","an","and","or","in","on","at","to","for","of","with"]);
const sentences = text.split(/[.!?]/);
const words = text.toLowerCase().match(/\\b[a-z][a-z0-9-]{2,}\\b/g) ?? [];
const bigrams: string[] = [];
for (let i = 0; i < words.length - 1; i++) {
  if (!stopWords.has(words[i]) && !stopWords.has(words[i+1])) {
    bigrams.push(words[i] + " " + words[i+1]);
  }
}
const freq: Record<string, number> = {};
for (const w of [...words.filter(w => !stopWords.has(w) && w.length > 4), ...bigrams]) {
  freq[w] = (freq[w] ?? 0) + 1;
}
const keywords = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0,12).map(([k]) => k);
const confidence = keywords.length >= 5 ? 0.85 : 0.6;
return { keywords, confidence };
        `.trim(),
        `
// Gen-1 mutation: position-weighted extraction
const text = String(input.text ?? "");
if (!text) return { keywords: [], confidence: 0 };
const stopWords = new Set(["the","a","an","and","or","but","in","on","at","to","for","of","with","by","from","is","are","was"]);
const words = text.toLowerCase().match(/\\b[a-z][a-z0-9]{3,}\\b/g) ?? [];
const freq: Record<string, number> = {};
words.forEach((w, i) => {
  if (!stopWords.has(w)) {
    const posBoost = i < words.length * 0.2 ? 2 : 1; // title bias
    freq[w] = (freq[w] ?? 0) + posBoost;
  }
});
const keywords = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k])=>k);
const confidence = Math.min(0.9, 0.55 + keywords.length * 0.03);
return { keywords, confidence };
        `.trim(),
      ],

      "research-summarizer": [
        `
// Gen-1 mutation: structured summary with key findings extraction
const text = String(input.text ?? "");
if (!text) return { summary: "", keyFindings: [], wordCount: 0 };
const sentences = text.split(/(?<=[.!?])\\s+/).filter(s => s.trim().length > 20);
// Extract summary from first and last meaningful sentence
const summary = [sentences[0], sentences[sentences.length - 1]].filter(Boolean).join(" ");
// Extract key findings: sentences with signal phrases
const signalPhrases = /demonstrate|show|find|propose|introduce|improve|achieve|result|conclude/i;
const keyFindings = sentences
  .filter(s => signalPhrases.test(s))
  .slice(0, 4)
  .map(s => s.trim());
// Ensure at least 2 findings
if (keyFindings.length < 2) {
  sentences.slice(1, 4).forEach(s => { if (!keyFindings.includes(s.trim())) keyFindings.push(s.trim()); });
}
return { summary: summary.trim(), keyFindings: keyFindings.slice(0, 4), wordCount: text.split(/\\s+/).length };
        `.trim(),
        `
// Gen-1 mutation: topic-sentence based summary with technique detection
const text = String(input.text ?? "");
if (!text) return { summary: "", keyFindings: [], wordCount: 0 };
const sentences = text.match(/[^.!?]+[.!?]/g) ?? [];
const techniques = ["RLHF","transformer","retrieval","chain-of-thought","mixture-of-experts","RAG","attention","fine-tuning","prompting"];
const mentionedTech = techniques.filter(t => new RegExp(t, "i").test(text));
const keyFindings = sentences
  .filter(s => mentionedTech.some(t => new RegExp(t,"i").test(s)) || /challenge|improve|show|result/i.test(s))
  .slice(0, 3)
  .map(s => s.trim());
if (keyFindings.length < 2) {
  sentences.slice(0, 3).forEach(s => keyFindings.push(s.trim()));
}
const summary = sentences.slice(0, 2).join(" ").trim();
return { summary, keyFindings: keyFindings.slice(0, 4), wordCount: text.split(/\\s+/).length, techniques: mentionedTech };
        `.trim(),
        `
// Gen-1 mutation: paragraph-aware structured summary
const text = String(input.text ?? "");
if (!text) return { summary: "", keyFindings: [], wordCount: 0 };
const paragraphs = text.split(/\\n+/).filter(p => p.trim().length > 30);
const allSentences = text.split(/(?<=[.!?])\\s+/).filter(s => s.length > 15);
const firstSentence = allSentences[0] ?? "";
const lastSentence = allSentences[allSentences.length - 1] ?? "";
const summary = (firstSentence + " " + lastSentence).trim();
const keyFindings = allSentences
  .filter((s,i) => i > 0 && (/however|although|recent|proposed|demonstrates|enables/i.test(s)))
  .slice(0, 3)
  .map(s => s.trim());
while (keyFindings.length < 2 && allSentences[keyFindings.length + 1]) {
  keyFindings.push(allSentences[keyFindings.length + 1]!.trim());
}
return { summary, keyFindings, wordCount: text.split(/\\s+/).length };
        `.trim(),
      ],

      "citation-extractor": [
        `
// Gen-1 mutation: multi-pattern citation extraction
const text = String(input.text ?? "");
if (!text) return { citations: [], count: 0 };
const citations = [];
// Pattern 1: (Author et al., Year)
const p1 = /\\(([A-Z][a-z]+(?:\\s+et\\s+al\\.)?),\\s*(\\d{4})\\)/g;
// Pattern 2: (Author Year) — no comma
const p2 = /\\(([A-Z][a-z]+(?:\\s+et\\s+al\\.)?)[,\\s]+(\\d{4})\\)/g;
// Pattern 3: Author (Year)
const p3 = /([A-Z][a-z]+(?:\\s+et\\s+al\\.)?(?:\\s+[A-Z][a-z]+)?)\\s+\\((\\d{4})\\)/g;
const seen = new Set();
for (const pattern of [p1, p2, p3]) {
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const key = match[1] + match[2];
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({ author: match[1].trim(), year: match[2], raw: match[0] });
    }
  }
}
return { citations, count: citations.length };
        `.trim(),
      ],

      "code-reviewer": [
        `
// Gen-1: detects SQL injection, missing await, missing try-catch, var usage, debug logs
const code = String(input.code ?? "");
if (!code) return { issues: [], score: 100, issueCount: 0, summary: "No code to analyze" };
const issues = [];

// SQL injection: string concatenation inside a db query
if (/db\\.(query|execute|run)\\s*\\(\\s*["'\`][^"'\`]*["'\`]\\s*\\+/.test(code) ||
    (/["'\`]\\s*\\+\\s*\\w/.test(code) && /SELECT|INSERT|UPDATE|DELETE|WHERE/i.test(code))) {
  issues.push({ type: "sql-injection", severity: "critical", fix: "Use parameterized queries — never concatenate user input into SQL" });
}

// Missing await on response.json() — most common async bug
if (/\\bvar\\b[^\\n]*=\\s*response\\.json\\(\\)/.test(code) ||
    /(?<!await\\s)response\\.json\\(\\)/.test(code.replace(/await\\s+response\\.json/g, ""))) {
  issues.push({ type: "missing-await", severity: "high", fix: "Add await before response.json()" });
}

// Async function with no try-catch
const hasAsync = /async\\s+(function|\\()/.test(code);
const hasTryCatch = /try\\s*\\{/.test(code);
if (hasAsync && !hasTryCatch) {
  issues.push({ type: "missing-error-handling", severity: "high", fix: "Wrap async operations in try-catch" });
}

// var usage (old JS habit)
const varCount = (code.match(/\\bvar\\b/g) ?? []).length;
if (varCount > 0) {
  issues.push({ type: "var-usage", severity: "low", count: varCount, fix: "Replace var with const or let" });
}

// Debug logs left in
const logCount = (code.match(/console\\.log/g) ?? []).length;
if (logCount > 0) {
  issues.push({ type: "debug-log", severity: "low", count: logCount, fix: "Remove console.log or use a proper logger" });
}

const critical = issues.filter(i => i.severity === "critical").length;
const high = issues.filter(i => i.severity === "high").length;
const score = Math.max(0, 100 - critical * 35 - high * 20 - issues.length * 5);
const types = [...new Set(issues.map(i => i.type))].join(", ");
return { issues, score, issueCount: issues.length, summary: issues.length === 0 ? "No issues detected" : issues.length + " issue(s): " + types };
        `.trim(),
      ],
    };

    const pool = variants[skillName] ?? variants["keyword-extractor"]!;
    // Cycle through variants if count > available
    return Array.from({ length: count }, (_, i) => pool[i % pool.length]!);
  }

  // ---------------------------------------------------------------------------
  // Response parsing
  // ---------------------------------------------------------------------------

  private parseComputeResponse(data: ZgComputeResponse, count: number): MutationCandidate[] {
    const candidates: MutationCandidate[] = [];
    const attestation = data.attestation
      ? `${data.attestation.signature}:${data.attestation.outputHash}`
      : `unattested-${data.id}`;

    for (const choice of data.choices.slice(0, count)) {
      const content = choice.message.content;
      const parsed = this.extractImplementation(content);
      // Skip empty implementations — they always score 0
      if (!parsed.implementation.trim()) continue;
      candidates.push({
        implementation: parsed.implementation,
        rationale: parsed.rationale,
        attestation,
      });
    }

    // If model returned single message with all candidates in JSON
    if (candidates.length === 0 && data.choices.length === 1) {
      const content = data.choices[0]!.message.content;
      try {
        const json = JSON.parse(content) as {
          candidates: Array<{ implementation: string; rationale: string }>;
        };
        for (const c of json.candidates.slice(0, count)) {
          candidates.push({
            implementation: c.implementation,
            rationale: c.rationale,
            attestation,
          });
        }
      } catch {
        // Single candidate fallback
        const parsed = this.extractImplementation(content);
        candidates.push({ ...parsed, attestation });
      }
    }

    return candidates;
  }

  /**
   * Strip outer function wrapper if the model returned the full function signature.
   * Our sandbox already wraps the body in `async function skillExecute(input, context) { <body> }`,
   * so we only want the *body* (the statements inside the outermost curly braces).
   */
  private stripFunctionWrapper(code: string): string {
    const trimmed = code.trim();

    // async (input, context) => { ... }
    const arrowMatch = trimmed.match(/^async\s*\([^)]*\)\s*=>\s*\{([\s\S]*)\}\s*$/);
    if (arrowMatch?.[1]) return arrowMatch[1].trim();

    // async function name(input, context) { ... }  OR  (async function(...) { ... })
    const fnMatch = trimmed.match(
      /^(?:\(?\s*)?async\s+function[^(]*\([^)]*\)\s*\{([\s\S]*)\}\s*\)?\s*$/,
    );
    if (fnMatch?.[1]) return fnMatch[1].trim();

    return trimmed;
  }

  private extractImplementation(raw: string): {
    implementation: string;
    rationale: string;
  } {
    // Primary: extract a ```javascript / ```js / ```typescript / ```ts block
    const jsBlockMatch = raw.match(/```(?:javascript|typescript|js|ts)\n?([\s\S]*?)```/);
    if (jsBlockMatch?.[1]) {
      const body = jsBlockMatch[1].trim();
      // First line may be a rationale comment: // rationale: ...
      const lines = body.split("\n");
      let rationale = "";
      let startLine = 0;
      if (lines[0]?.trim().startsWith("//")) {
        rationale = lines[0].replace(/^\/\/\s*rationale:\s*/i, "").trim();
        startLine = 1;
      }
      const implementation = this.stripFunctionWrapper(lines.slice(startLine).join("\n").trim());
      return { implementation, rationale };
    }

    // Fallback: try ```json block with JSON.parse
    const jsonBlockMatch = raw.match(/```json\n?([\s\S]*?)```/);
    if (jsonBlockMatch?.[1]) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1]) as {
          implementation?: string;
          rationale?: string;
          code?: string;
        };
        const impl = parsed.implementation ?? parsed.code ?? "";
        return {
          implementation: this.stripFunctionWrapper(impl),
          rationale: parsed.rationale ?? "",
        };
      } catch {
        // JSON has unescaped quotes — try regex extraction of the value
        const implMatch = jsonBlockMatch[1].match(
          /"(?:implementation|code)"\s*:\s*"((?:[^"\\]|\\.|\n)*?)"\s*[,}]/s,
        );
        if (implMatch?.[1]) {
          const impl = implMatch[1]
            .replace(/\\n/g, "\n")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
          return { implementation: this.stripFunctionWrapper(impl), rationale: "" };
        }
      }
    }

    // Last resort: the raw content itself (might be a bare code block or inline code)
    return { implementation: this.stripFunctionWrapper(raw.trim()), rationale: "" };
  }

  // ---------------------------------------------------------------------------
  // Prompt builder
  // ---------------------------------------------------------------------------

  private buildMutationPrompt(ctx: MutationContext, _count: number): string {
    return `
## Skill Evolution Request

Improve this failing skill implementation. Return a single improved candidate.

### Skill: "${ctx.parentGenome.name}"
**Description:** ${ctx.parentGenome.description}
**Domain:** ${ctx.parentGenome.domain}

### Current Implementation (function BODY only):
\`\`\`javascript
${ctx.parentGenome.implementation}
\`\`\`

### Failure:
- **Reason:** ${ctx.failureReason}
- **Task:** ${ctx.failedTaskDescription}
${ctx.hint ? `\n### IMPORTANT — Expected Output Shape:\n${ctx.hint}` : ""}

### Output format — return ONLY this, nothing else:
\`\`\`javascript
// rationale: <one sentence explaining the fix>
<BODY statements only — pure JS, no imports, no async wrapper>
\`\`\`
    `.trim();
  }
}

// ---------------------------------------------------------------------------
// System prompt for evolution
// ---------------------------------------------------------------------------

const EVOLUTION_SYSTEM_PROMPT = `You are EvoFrame's Evolution Engine — a specialist in generating improved JavaScript skill implementations for AI agents.

You receive a failing skill and must return an improved mutation as a javascript code block.

CRITICAL RULES:
- Return ONLY a single \`\`\`javascript code block — nothing else before or after it
- The FIRST LINE of the block must be a comment: // rationale: <one sentence>
- The rest is ONLY the function BODY statements — NOT wrapped in async () => {}
- No require(), import, or fetch() allowed (pure in-memory logic only)
- Must handle all edge cases mentioned in the failure report

Example of correct format:
\`\`\`javascript
// rationale: Added stop words filter and frequency scoring for better keyword quality
const text = String(input.text ?? '');
if (!text) return { keywords: [], confidence: 0 };
const words = text.toLowerCase().split(/\\W+/);
return { keywords: [...new Set(words.filter(w => w.length > 4))], confidence: 0.8 };
\`\`\`
`;
