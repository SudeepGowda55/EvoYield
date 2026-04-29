// Evolution hint — what the 0G AI model receives when it rewrites the strategy.
// Be extremely explicit to prevent the model from generating broken math.
export const evolveHint = [
  "Write a JavaScript yield allocation function. No imports. No fetch. No require.",
  "Input object: { aave_apy, morpho_apy, yearn_apy, sky_apy } — numbers.",
  "Output object: { aave, morpho, yearn, sky } — integers that sum to EXACTLY 100.",
  "",
  "Follow this exact algorithm:",
  "1. Build an array of 4 objects: [{ name:'aave', apy:aave_apy }, { name:'morpho', apy:morpho_apy }, { name:'yearn', apy:yearn_apy }, { name:'sky', apy:sky_apy }]",
  "2. Sort the array by .apy DESCENDING (highest first).",
  "3. The fixed weights are: rank-1 gets 50, rank-2 gets 30, rank-3 gets 15, rank-4 gets 5. These always sum to 100.",
  "4. Assign: sorted[0] gets 50, sorted[1] gets 30, sorted[2] gets 15, sorted[3] gets 5.",
  "5. Build a result object and set result[sorted[i].name] for each i.",
  "6. Return the result object.",
  "",
  "Example: if morpho=7.8, aave=3.2, yearn=4.1, sky=2.9 → sorted=[morpho,yearn,aave,sky] → return { morpho:50, yearn:30, aave:15, sky:5 }.",
  "The four values MUST always sum to 100. Never multiply weights by APY ratios.",
].join(" ");
