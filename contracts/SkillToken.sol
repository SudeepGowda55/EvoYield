// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SkillToken
 * @notice Minimal ERC-20 SKILL token issued to skill originators.
 *         Minting is restricted to the SkillRegistry contract.
 */
contract SkillToken {
    string public constant name = "EvoFrame Skill Token";
    string public constant symbol = "SKILL";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public registry;
    address public owner;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(
        address indexed owner_,
        address indexed spender,
        uint256 value
    );
    event RegistrySet(address indexed registry_);

    modifier onlyRegistry() {
        require(msg.sender == registry, "SkillToken: not registry");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "SkillToken: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setRegistry(address registry_) external onlyOwner {
        registry = registry_;
        emit RegistrySet(registry_);
    }

    function mint(address to, uint256 amount) external onlyRegistry {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(
            allowance[from][msg.sender] >= amount,
            "insufficient allowance"
        );
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
