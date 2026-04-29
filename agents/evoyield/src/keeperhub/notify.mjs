// Sends Telegram notifications after each rebalance cycle.
// Uses the standard Telegram Bot API — no extra library needed.
//
// Setup:
//   1. Message @BotFather → /newbot → get TELEGRAM_BOT_TOKEN
//   2. Start your bot, then open:
//      https://api.telegram.org/bot{TOKEN}/getUpdates
//      Look for "chat": { "id": ... } — that's your TELEGRAM_CHAT_ID

const TELEGRAM_API = "https://api.telegram.org";

export async function sendTelegram(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId || token === "your_bot_token" || chatId === "your_chat_id") {
    return; // Silently skip if not configured
  }

  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id:                  chatId,
      text:                     message,
      parse_mode:               "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.warn(`[Telegram] Notification failed: ${err}`);
  }
}

export function formatCycleMessage(marketData, result, khResult) {
  const { aave, morpho, yearn, sky } = result.allocation ?? {};
  const triggered = khResult?.triggered ? "✅ Executed" : "⏸ Pending setup";

  return (
    `<b>🔄 EvoYield Rebalance</b>\n` +
    `<i>${new Date().toUTCString()}</i>\n\n` +
    `<b>📊 Live APYs</b>\n` +
    `Aave: <b>${marketData.aave_apy}%</b>  |  Morpho: <b>${marketData.morpho_apy}%</b>\n` +
    `Yearn: <b>${marketData.yearn_apy}%</b>  |  Sky: <b>${marketData.sky_apy}%</b>\n\n` +
    `<b>⚡ Allocation (gen-${result.generation}, fitness=${result.fitnessScore})</b>\n` +
    `Aave: ${aave}%  |  Morpho: ${morpho}%\n` +
    `Yearn: ${yearn}%  |  Sky: ${sky}%\n\n` +
    `KeeperHub: ${triggered}`
  );
}
