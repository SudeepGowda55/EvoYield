// Discord webhook notifications.
//
// Setup (60 seconds):
//   Discord channel → ⚙ Edit Channel → Integrations → Webhooks → New Webhook
//   → Copy URL → paste as DISCORD_WEBHOOK_URL in .env
//
// We use a single rich embed per cycle:
//   • Color-coded by fitness (green/yellow/red)
//   • Sectioned fields for APYs, allocation, and KeeperHub status
//   • Honors Discord rate limits (429 → retry_after) up to MAX_RETRIES
//   • Silently skips when DISCORD_WEBHOOK_URL is unset (so devs without a
//     Discord aren't blocked).

const COLOR_HEALTHY  = 0x2ecc71; // green:  fitness ≥ 80
const COLOR_DEGRADED = 0xf1c40f; // yellow: fitness ≥ 60
const COLOR_FAILING  = 0xe74c3c; // red:    fitness < 60
const MAX_RETRIES    = 3;

function isConfigured() {
  const url = process.env.DISCORD_WEBHOOK_URL;
  return Boolean(url) && url !== "your_discord_webhook_url";
}

/**
 * Send a Discord message.
 * @param {string|object} payload  Either a plain string (sent as `content`)
 *                                 or a raw Discord webhook payload object.
 */
export async function sendDiscord(payload) {
  if (!isConfigured()) return { skipped: true };

  const url  = process.env.DISCORD_WEBHOOK_URL;
  const body = typeof payload === "string"
    ? { content: payload }
    : payload;

  if (process.env.DISCORD_USERNAME)   body.username   = process.env.DISCORD_USERNAME;
  if (process.env.DISCORD_AVATAR_URL) body.avatar_url = process.env.DISCORD_AVATAR_URL;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.warn(`[Discord] network error: ${err.message ?? err}`);
      return { sent: false, error: String(err) };
    }

    if (res.ok || res.status === 204) return { sent: true };

    if (res.status === 429 && attempt < MAX_RETRIES) {
      // Discord rate-limit. Body has retry_after in seconds (float); header
      // X-RateLimit-Reset-After is more precise. Cap at 10 s to avoid demo stalls.
      const headerWait = Number(res.headers.get("x-ratelimit-reset-after")) || 0;
      const json = await res.json().catch(() => ({}));
      const wait = Math.min(10, Math.max(headerWait, json.retry_after ?? 1)) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    const text = await res.text().catch(() => "");
    console.warn(`[Discord] ${res.status} — ${text.slice(0, 200)}`);
    return { sent: false, status: res.status, body: text };
  }
  return { sent: false, error: "exceeded retry budget" };
}

/** Pick an embed color from the strategy's fitness score. */
function colorFor(fitness) {
  if (fitness == null)    return COLOR_DEGRADED;
  if (fitness >= 80)      return COLOR_HEALTHY;
  if (fitness >= 60)      return COLOR_DEGRADED;
  return COLOR_FAILING;
}

function bullet(name, percent) {
  return `**${name}** \`${percent ?? "?"}%\``;
}

/**
 * Build a rich Discord webhook payload describing a single cycle.
 * Returns null if there's nothing meaningful to send (so the caller can skip).
 */
export function formatCycleMessage(marketData, result, khResult) {
  if (!result) return null;
  const a = result.allocation ?? {};
  const f = result.fitnessScore;

  const apyLine =
    `${bullet("Aave", marketData.aave_apy)} • ${bullet("Morpho", marketData.morpho_apy)}\n` +
    `${bullet("Yearn", marketData.yearn_apy)} • ${bullet("Sky", marketData.sky_apy)}`;

  const allocLine =
    `${bullet("Aave", a.aave)} • ${bullet("Morpho", a.morpho)}\n` +
    `${bullet("Yearn", a.yearn)} • ${bullet("Sky", a.sky)}`;

  let khStatus;
  if (khResult?.triggered) {
    const execution = khResult.executionId ? `\nExecution \`${khResult.executionId}\`` : "";
    const status = khResult.finalStatus ?? khResult.status;
    const statusText = status ? `\nStatus \`${status}\`` : "";
    khStatus = khResult.workflowId
      ? `:zap: Workflow \`${khResult.workflowId}\` triggered${execution}${statusText}`
      : `:zap: Workflow triggered${execution}${statusText}`;
  } else {
    khStatus = khResult?.error
      ? `:warning: Workflow not triggered: ${khResult.error}`
      : `:hourglass_flowing_sand: No workflow registered yet`;
  }

  return {
    embeds: [
      {
        title:       "🔄 EvoYield Rebalance",
        description: `Generation **${result.generation}**, fitness **${f}/100**`,
        color:       colorFor(f),
        timestamp:   new Date().toISOString(),
        fields: [
          { name: "📊 Live APYs",      value: apyLine,   inline: false },
          { name: "⚖️ Target alloc",  value: allocLine, inline: false },
          { name: "🤖 KeeperHub",     value: khStatus,  inline: false },
        ],
        footer: { text: "EvoYield • EvoFrame on 0G + KeeperHub" },
      },
    ],
  };
}

/** Convenience: alert when a new generation has been auto-synthesised. */
export function formatSynthMessage({ skill, workflowId, reused }) {
  if (!skill) return null;
  return {
    embeds: [
      {
        title:       reused ? "♻️ KeeperHub workflow reused" : "🛠 New KeeperHub workflow synthesised",
        description: `Skill \`${skill.name}\` gen-**${skill.generation}** → workflow \`${workflowId}\``,
        color:       reused ? COLOR_DEGRADED : COLOR_HEALTHY,
        timestamp:   new Date().toISOString(),
        footer:      { text: "EvoYield • Genome-to-Keeper synthesis" },
      },
    ],
  };
}

/** Convenience: alert when KeeperHub triggered a regeneration. */
export function formatRegenMessage({ reason, oldGeneration, newGeneration, fitness }) {
  return {
    embeds: [
      {
        title:       "🧬 Regeneration triggered by KeeperHub",
        description: `Reason: ${reason ?? "unspecified"}`,
        color:       newGeneration > (oldGeneration ?? 0) ? COLOR_HEALTHY : COLOR_FAILING,
        timestamp:   new Date().toISOString(),
        fields: [
          { name: "Generation", value: `${oldGeneration ?? "?"} → ${newGeneration ?? "?"}`, inline: true },
          { name: "Fitness",    value: `${fitness ?? "?"}/100`,                              inline: true },
        ],
        footer: { text: "EvoYield • /regenerate" },
      },
    ],
  };
}
