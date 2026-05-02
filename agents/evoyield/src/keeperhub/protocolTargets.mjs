const DEFAULT_TARGETS = {
  aave: "0x02b5e71D8C0D1e0C76EF66A7bA6bB58201363BB3",
  morpho: "0x0e2bb0C5802A1dDd4D56AB89bfC7f20732D91B5c",
  yearn: "0x24BF9F1c089b0374e3bDFA0Ed3c6D6C815D9C816",
  sky: "0xc0468ee91158e409814de57a7918217B30589a70",
};

const ENV_KEYS = {
  aave: "EVOYIELD_AAVE_VAULT",
  morpho: "EVOYIELD_MORPHO_VAULT",
  yearn: "EVOYIELD_YEARN_VAULT",
  sky: "EVOYIELD_SKY_VAULT",
};

export function getProtocolTargets() {
  return Object.fromEntries(
    Object.entries(DEFAULT_TARGETS).map(([protocol, fallback]) => {
      const envValue =
        process.env[ENV_KEYS[protocol]]?.trim() ??
        process.env[`${protocol.toUpperCase()}_SEPOLIA_TARGET`]?.trim();
      return [protocol, envValue || fallback];
    }),
  );
}

export function getExecutableProtocols() {
  const targets = getProtocolTargets();
  return Object.entries(targets)
    .filter(([, address]) => Boolean(address))
    .map(([protocol]) => protocol);
}
