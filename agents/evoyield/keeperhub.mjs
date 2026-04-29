// Entry point: runs one full EvoYield cycle.
//   1. Fetch live APYs from DefiLlama
//   2. Get evolved allocation from EvoFrame (0G compute)
//   3. Trigger KeeperHub rebalance workflow
//   4. Send Discord notification
//
// Usage: node keeperhub.mjs
// For continuous running, use a cron job or KeeperHub schedule trigger.

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const require   = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require("dotenv").config({ path: resolve(__dirname, ".env") });

import { runCycle } from "./src/keeperhub/cycle.mjs";

await runCycle();
