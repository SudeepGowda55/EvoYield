// Fetches real live APY data from DefiLlama's yield aggregator.
// No API key needed. Covers Aave V3, Morpho Blue, Yearn V3, Sky (SSR).
// Data is cached for 5 minutes to avoid hammering the API.
//
// DefiLlama pools API: https://yields.llama.fi/pools

const DEFILLAMA_URL = "https://yields.llama.fi/pools";

// Project slugs to try for each protocol (in priority order)
const SLUGS = {
  aave:   ["aave-v3", "aave-v4"],
  morpho: ["morpho-blue", "morpho"],
  yearn:  ["yearn-finance", "yearn-v3"],
  sky:    ["sky", "spark", "maker-dsr"],
};

// Symbol substrings to match (tries each in order until a pool is found)
const SYMBOLS = {
  aave:   ["USDC"],
  morpho: ["USDC"],
  yearn:  ["USDC"],
  sky:    ["USDS", "DAI", "USDC"],
};

let _poolCache     = null;
let _cacheTime     = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchAllPools() {
  const now = Date.now();
  if (_poolCache && now - _cacheTime < CACHE_TTL_MS) return _poolCache;

  const res = await fetch(DEFILLAMA_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`DefiLlama API error: ${res.status}`);

  const { data } = await res.json();
  _poolCache = data;
  _cacheTime = now;
  return data;
}

function findPool(pools, slugs, symbols, chain = "Ethereum") {
  for (const symbol of symbols) {
    for (const slug of slugs) {
      const matches = pools.filter(
        (p) =>
          p.chain === chain &&
          p.project === slug &&
          p.symbol.toUpperCase().includes(symbol.toUpperCase()) &&
          (p.apyBase ?? p.apy ?? 0) > 0
      );
      if (matches.length > 0) {
        // Pick the pool with the largest TVL for stability (avoids tiny/illiquid pools)
        matches.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
        const p = matches[0];
        return {
          apy:     Number((p.apyBase ?? p.apy ?? 0).toFixed(2)),
          project: p.project,
          symbol:  p.symbol,
          tvlUsd:  p.tvlUsd,
          pool:    p.pool,
        };
      }
    }
  }
  return { apy: 0, project: null, symbol: null, tvlUsd: 0, pool: null };
}

export async function fetchApyData() {
  console.log("\n📡 Fetching live APY data from DefiLlama...");
  const pools = await fetchAllPools();

  const aave   = findPool(pools, SLUGS.aave,   SYMBOLS.aave);
  const morpho = findPool(pools, SLUGS.morpho, SYMBOLS.morpho);
  const yearn  = findPool(pools, SLUGS.yearn,  SYMBOLS.yearn);
  const sky    = findPool(pools, SLUGS.sky,    SYMBOLS.sky);

  const data = {
    aave_apy:   aave.apy,
    morpho_apy: morpho.apy,
    yearn_apy:  yearn.apy,
    sky_apy:    sky.apy,
  };

  console.log(
    `   Aave ${data.aave_apy}%` +
    `  |  Morpho ${data.morpho_apy}%` +
    `  |  Yearn ${data.yearn_apy}%` +
    `  |  Sky ${data.sky_apy}%`
  );

  return data;
}
