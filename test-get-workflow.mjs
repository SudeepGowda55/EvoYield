import { config } from "dotenv";
config();
import { client as kh } from "./src/keeperhub/client.mjs";
const wf = await kh.get("/workflows/" + process.env.KH_REBALANCE_WORKFLOW_ID);
const node = wf.nodes.find(n => n.data?.config?.functionName === "rebalanceAmountToTargets");
console.log(node.data.config.functionArgs);
