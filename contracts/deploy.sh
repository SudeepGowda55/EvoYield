#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# deploy.sh — Deploy EvoFrame contracts to 0G Galileo testnet
#
# Prerequisites:
#   - Foundry installed (curl -L https://foundry.paradigm.xyz | bash && foundryup)
#   - ZG_PRIVATE_KEY exported in your shell (or set in .env)
#
# Usage:
#   cd contracts
#   export ZG_PRIVATE_KEY=0x<your_private_key>
#   bash deploy.sh
#
# After deploying, paste the printed addresses into agents/evoyield/.env:
#   SKILL_REGISTRY_ADDRESS=0x...
#   SKILL_TOKEN_ADDRESS=0x...
# ---------------------------------------------------------------------------
set -euo pipefail

# Load .env from agent if ZG_PRIVATE_KEY not already set
if [[ -z "${ZG_PRIVATE_KEY:-}" ]]; then
  ENV_FILE="$(dirname "$0")/../agents/evoyield/.env"
  if [[ -f "$ENV_FILE" ]]; then
    export $(grep -E '^ZG_PRIVATE_KEY=' "$ENV_FILE" | xargs)
  fi
fi

if [[ -z "${ZG_PRIVATE_KEY:-}" ]]; then
  echo "❌  ZG_PRIVATE_KEY is not set. Export it or add it to agents/evoyield/.env"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  EvoFrame Contract Deployment → 0G Galileo Testnet"
echo "════════════════════════════════════════════════════════"
echo ""

# Compile
echo "🔨  Compiling contracts..."
forge build --root . 2>&1

echo ""
echo "🚀  Deploying to 0G Galileo (chain ID 16600)..."

# Deploy and capture output
OUTPUT=$(forge create \
  --rpc-url https://evmrpc-testnet.0g.ai \
  --private-key "$ZG_PRIVATE_KEY" \
  --broadcast \
  SkillToken.sol:SkillToken 2>&1)

echo "$OUTPUT"
TOKEN_ADDRESS=$(echo "$OUTPUT" | grep -i "Deployed to" | awk '{print $NF}')

OUTPUT2=$(forge create \
  --rpc-url https://evmrpc-testnet.0g.ai \
  --private-key "$ZG_PRIVATE_KEY" \
  --broadcast \
  SkillRegistry.sol:SkillRegistry 2>&1)

echo "$OUTPUT2"
REGISTRY_ADDRESS=$(echo "$OUTPUT2" | grep -i "Deployed to" | awk '{print $NF}')

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ✅  Deployment complete!"
echo "════════════════════════════════════════════════════════"
echo ""
echo "  SkillToken    : $TOKEN_ADDRESS"
echo "  SkillRegistry : $REGISTRY_ADDRESS"
echo ""
echo "  Add these to agents/evoyield/.env:"
echo "    SKILL_REGISTRY_ADDRESS=$REGISTRY_ADDRESS"
echo "    SKILL_TOKEN_ADDRESS=$TOKEN_ADDRESS"
echo ""

# Optionally wire token → registry on-chain
if [[ -n "$TOKEN_ADDRESS" && -n "$REGISTRY_ADDRESS" ]]; then
  echo "🔗  Wiring SkillToken → SkillRegistry..."
  # setRegistry(address) on SkillToken
  cast send \
    --rpc-url https://evmrpc-testnet.0g.ai \
    --private-key "$ZG_PRIVATE_KEY" \
    --priority-gas-price 3000000000 --gas-price 3000000000 \
    "$TOKEN_ADDRESS" \
    "setRegistry(address)" "$REGISTRY_ADDRESS" 2>&1 || true

  # setSkillToken(address) on SkillRegistry
  cast send \
    --rpc-url https://evmrpc-testnet.0g.ai \
    --private-key "$ZG_PRIVATE_KEY" \
    --priority-gas-price 3000000000 --gas-price 3000000000 \
    "$REGISTRY_ADDRESS" \
    "setSkillToken(address)" "$TOKEN_ADDRESS" 2>&1 || true

  echo "  ✅  Contracts wired."
fi
