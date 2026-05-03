// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Minimal ERC4626-like vault for Sepolia USDC demos. One share equals one asset.
contract EvoYieldMockVault {
    IERC20Like public immutable asset;

    string public name;
    string public symbol;
    uint8 public immutable decimals;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(
        address indexed caller,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(address asset_, string memory name_, string memory symbol_) {
        require(asset_ != address(0), "asset zero");
        asset = IERC20Like(asset_);
        name = name_;
        symbol = symbol_;
        decimals = IERC20Like(asset_).decimals();
    }

    function convertToShares(uint256 assets) public pure returns (uint256) {
        return assets;
    }

    function convertToAssets(uint256 shares) public pure returns (uint256) {
        return shares;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(receiver != address(0), "receiver zero");
        require(assets > 0, "zero assets");

        shares = convertToShares(assets);
        require(asset.transferFrom(msg.sender, address(this), assets), "asset transfer failed");

        totalSupply += shares;
        balanceOf[receiver] += shares;

        emit Transfer(address(0), receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        require(receiver != address(0), "receiver zero");
        require(owner != address(0), "owner zero");
        require(assets > 0, "zero assets");

        shares = convertToShares(assets);

        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender];
            require(allowed >= shares, "insufficient allowance");
            allowance[owner][msg.sender] = allowed - shares;
            emit Approval(owner, msg.sender, allowance[owner][msg.sender]);
        }

        require(balanceOf[owner] >= shares, "insufficient shares");

        balanceOf[owner] -= shares;
        totalSupply -= shares;

        require(asset.transfer(receiver, assets), "asset transfer failed");

        emit Transfer(owner, address(0), shares);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }
}

/// @notice Remix-friendly factory that deploys the four EvoYield demo vaults.
contract EvoYieldVaultFactory {
    address public immutable usdc;

    EvoYieldMockVault public immutable aaveVault;
    EvoYieldMockVault public immutable morphoVault;
    EvoYieldMockVault public immutable yearnVault;
    EvoYieldMockVault public immutable skyVault;

    constructor(address usdc_) {
        require(usdc_ != address(0), "usdc zero");
        usdc = usdc_;

        aaveVault = new EvoYieldMockVault(usdc_, "EvoYield Aave Mock Vault", "evAAVE");
        morphoVault = new EvoYieldMockVault(usdc_, "EvoYield Morpho Mock Vault", "evMORPHO");
        yearnVault = new EvoYieldMockVault(usdc_, "EvoYield Yearn Mock Vault", "evYEARN");
        skyVault = new EvoYieldMockVault(usdc_, "EvoYield Sky Mock Vault", "evSKY");
    }

    function vaults()
        external
        view
        returns (address aave, address morpho, address yearn, address sky)
    {
        return (address(aaveVault), address(morphoVault), address(yearnVault), address(skyVault));
    }
}

/// @notice Rebalances an explicit Sepolia USDC pool amount across the four demo vaults.
contract EvoYieldRebalancer {
    IERC20Like public immutable usdc;

    address public immutable aaveVault;
    address public immutable morphoVault;
    address public immutable yearnVault;
    address public immutable skyVault;

    event Rebalanced(
        address indexed owner,
        uint256 poolAssets,
        uint256 aaveTarget,
        uint256 morphoTarget,
        uint256 yearnTarget,
        uint256 skyTarget
    );

    constructor(
        address usdc_,
        address aaveVault_,
        address morphoVault_,
        address yearnVault_,
        address skyVault_
    ) {
        require(usdc_ != address(0), "usdc zero");
        require(aaveVault_ != address(0), "aave zero");
        require(morphoVault_ != address(0), "morpho zero");
        require(yearnVault_ != address(0), "yearn zero");
        require(skyVault_ != address(0), "sky zero");

        usdc = IERC20Like(usdc_);
        aaveVault = aaveVault_;
        morphoVault = morphoVault_;
        yearnVault = yearnVault_;
        skyVault = skyVault_;
    }

    function vaultBalances(address owner)
        public
        view
        returns (uint256 aave, uint256 morpho, uint256 yearn, uint256 sky)
    {
        return (
            EvoYieldMockVault(aaveVault).balanceOf(owner),
            EvoYieldMockVault(morphoVault).balanceOf(owner),
            EvoYieldMockVault(yearnVault).balanceOf(owner),
            EvoYieldMockVault(skyVault).balanceOf(owner)
        );
    }

    /// @param poolAssets Explicit USDC amount to manage. For 0.1 USDC, pass 100000.
    function rebalanceAmountToTargets(
        uint256 poolAssets,
        uint256 aaveBps,
        uint256 morphoBps,
        uint256 yearnBps,
        uint256 skyBps
    ) external {
        require(poolAssets > 0, "pool zero");
        require(aaveBps + morphoBps + yearnBps + skyBps == 10_000, "targets must sum 10000");

        address owner = msg.sender;

        uint256 aaveTarget = (poolAssets * aaveBps) / 10_000;
        uint256 morphoTarget = (poolAssets * morphoBps) / 10_000;
        uint256 yearnTarget = (poolAssets * yearnBps) / 10_000;
        uint256 skyTarget = poolAssets - aaveTarget - morphoTarget - yearnTarget;

        _withdrawExcess(owner, aaveVault, aaveTarget);
        _withdrawExcess(owner, morphoVault, morphoTarget);
        _withdrawExcess(owner, yearnVault, yearnTarget);
        _withdrawExcess(owner, skyVault, skyTarget);

        _depositShortfall(owner, aaveVault, aaveTarget);
        _depositShortfall(owner, morphoVault, morphoTarget);
        _depositShortfall(owner, yearnVault, yearnTarget);
        _depositShortfall(owner, skyVault, skyTarget);

        emit Rebalanced(owner, poolAssets, aaveTarget, morphoTarget, yearnTarget, skyTarget);
    }

    function _withdrawExcess(address owner, address vault, uint256 target) internal {
        uint256 current = EvoYieldMockVault(vault).balanceOf(owner);
        if (current <= target) return;

        EvoYieldMockVault(vault).withdraw(current - target, owner, owner);
    }

    function _depositShortfall(address owner, address vault, uint256 target) internal {
        uint256 current = EvoYieldMockVault(vault).balanceOf(owner);
        if (current >= target) return;

        uint256 shortfall = target - current;
        require(usdc.transferFrom(owner, address(this), shortfall), "pull USDC failed");
        require(usdc.approve(vault, shortfall), "approve vault failed");

        EvoYieldMockVault(vault).deposit(shortfall, owner);
    }
}
