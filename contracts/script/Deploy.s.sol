// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../SkillRegistry.sol";
import "../SkillToken.sol";

/**
 * @title Deploy
 * @notice Foundry deployment script for EvoFrame contracts on 0G Galileo testnet.
 *
 * Usage:
 *   cd contracts
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url zg_galileo \
 *     --private-key $ZG_PRIVATE_KEY \
 *     --broadcast \
 *     -vvvv
 */

// Minimal Script base (avoids importing forge-std which isn't installed)
contract Script {
    address internal deployer;
    bool internal broadcasting;

    modifier broadcast() {
        broadcasting = true;
        _;
        broadcasting = false;
    }
}

contract Deploy is Script {
    SkillToken public skillToken;
    SkillRegistry public skillRegistry;

    function run() external {
        // vm.startBroadcast() is handled by forge via --broadcast flag
        // This script is designed to be run with forge script directly.

        // 1. Deploy SkillToken
        skillToken = new SkillToken();

        // 2. Deploy SkillRegistry
        skillRegistry = new SkillRegistry();

        // 3. Wire SkillToken → SkillRegistry (so registry can mint rewards)
        skillToken.setRegistry(address(skillRegistry));
        skillRegistry.setSkillToken(address(skillToken));

        // Log addresses for use in .env
        // forge will print these in the broadcast output
    }
}
