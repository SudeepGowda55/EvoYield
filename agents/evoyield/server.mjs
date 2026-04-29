// Entry point: HTTP server that exposes the agent as a REST API.
// KeeperHub calls POST /evaluate to get an allocation decision.
// Usage: npm start

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const require   = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require("dotenv").config({ path: resolve(__dirname, ".env") });

import { app, initAgent } from "./src/server/app.mjs";

const PORT = Number(process.env.PORT ?? 3001);

await initAgent();

app.listen(PORT, () => {
  console.log(`\n🚀 EvoYield API → http://localhost:${PORT}`);
  console.log("   POST /evaluate  { aave_apy, morpho_apy, yearn_apy, sky_apy }");
  console.log("   GET  /status    — current strategy generation + fitness");
  console.log("   GET  /health    — liveness check\n");
  console.log("   Expose publicly with: npx ngrok http 3001");
  console.log("   Then set EVOYIELD_PUBLIC_URL in KeeperHub workflow.\n");
});
