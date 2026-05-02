import { config } from "dotenv";
config();
import { kh } from "./src/keeperhub/client.mjs";
const wf = await kh.get("/workflows/" + process.env.KH_REBALANCE_WORKFLOW_ID);
const node = wf.nodes.find(n => n.data?.config?.functionName === "rebalanceAmountToTargets");
if (!node) {
  wf.nodes.forEach(n => console.dir(n.data?.config, {depth: null}));
} else {
  console.log("type:", typeof node.data.config.functionArgs, "val:", node.data.config.functionArgs);
}
