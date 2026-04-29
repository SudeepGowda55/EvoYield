// Benchmarks define what "good" means for the allocation strategy.
// Any evolved candidate must pass these to be promoted.
export const benchmarks = [
  {
    id: "morpho-leads-when-highest",
    input: { aave_apy: 3.2, morpho_apy: 7.8, yearn_apy: 4.1, sky_apy: 2.9 },
    validate: (o) => (o?.morpho ?? 0) >= 40 ? 100 : 0,
  },
  {
    id: "aave-leads-when-highest",
    input: { aave_apy: 8.5, morpho_apy: 5.2, yearn_apy: 3.8, sky_apy: 2.1 },
    validate: (o) => (o?.aave ?? 0) >= 40 ? 100 : 0,
  },
  {
    id: "yearn-leads-when-highest",
    input: { aave_apy: 3.0, morpho_apy: 3.5, yearn_apy: 9.2, sky_apy: 2.5 },
    validate: (o) => (o?.yearn ?? 0) >= 40 ? 100 : 0,
  },
  {
    id: "allocations-sum-to-100",
    input: { aave_apy: 4.0, morpho_apy: 5.0, yearn_apy: 3.0, sky_apy: 2.5 },
    validate: (o) => {
      const sum = (o?.aave ?? 0) + (o?.morpho ?? 0) + (o?.yearn ?? 0) + (o?.sky ?? 0);
      return Math.abs(sum - 100) <= 1 ? 100 : 0;
    },
  },
];
