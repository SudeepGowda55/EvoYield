// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SkillRegistry
 * @notice On-chain registry for EvoFrame skill genomes deployed on 0G Chain.
 *
 * Responsibilities:
 *  1. Record every promoted skill genome with its lineage (parent hash)
 *  2. Track fitness scores and usage counts
 *  3. Issue SKILL tokens to originators when their skills are imported
 *  4. Enable agents to query top-performing skills by domain
 *
 * Deployed on: 0G Chain (EVM-compatible, chain ID: 16600)
 */

// ---------------------------------------------------------------------------
// Minimal ERC-20 interface for SKILL token
// ---------------------------------------------------------------------------

interface IERC20Mintable {
    function mint(address to, uint256 amount) external;
}

// ---------------------------------------------------------------------------
// SkillRegistry
// ---------------------------------------------------------------------------

contract SkillRegistry {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    struct SkillEntry {
        bytes32 skillId; // keccak256(uuid)
        bytes32 parentId; // keccak256(parentUuid), 0x0 for genesis
        address originAgent; // wallet address that submitted the skill
        string storageHash; // 0G Storage merkle root / content hash
        string name; // human-readable skill name
        uint8 domain; // domain enum (see DOMAIN_* constants)
        uint32 generation; // mutation generation (0 = genesis)
        uint32 fitnessScore; // 0-100
        uint64 usageCount; // times imported by other agents
        uint64 createdAt; // unix timestamp
        bool active; // false if superseded by a child skill
    }

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    /// skillId → SkillEntry
    mapping(bytes32 => SkillEntry) public skills;

    /// domain → sorted list of active skill IDs (by fitnessScore desc)
    mapping(uint8 => bytes32[]) private _domainIndex;

    /// originAgent → earned SKILL token balance (wei)
    mapping(address => uint256) public pendingRewards;

    /// Total number of registered skills
    uint256 public totalSkills;

    /// SKILL token contract (optional — set after deployment)
    address public skillTokenAddress;

    /// Contract owner
    address public owner;

    /// Reward per skill import in SKILL tokens (1 token = 1e18)
    uint256 public constant REWARD_PER_IMPORT = 1e16; // 0.01 SKILL

    // -----------------------------------------------------------------------
    // Domain constants (mirrors SkillDomain enum in TypeScript)
    // -----------------------------------------------------------------------

    uint8 public constant DOMAIN_RESEARCH = 0;
    uint8 public constant DOMAIN_CODING = 1;
    uint8 public constant DOMAIN_REASONING = 2;
    uint8 public constant DOMAIN_DATA_ANALYSIS = 3;
    uint8 public constant DOMAIN_WEB_BROWSING = 4;
    uint8 public constant DOMAIN_COMMUNICATION = 5;
    uint8 public constant DOMAIN_PLANNING = 6;
    uint8 public constant DOMAIN_GENERAL = 7;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event SkillRegistered(
        bytes32 indexed skillId,
        bytes32 indexed parentId,
        address indexed originAgent,
        string name,
        uint8 domain,
        uint32 generation,
        uint32 fitnessScore,
        string storageHash
    );

    event SkillImported(
        bytes32 indexed skillId,
        address indexed importingAgent,
        address indexed originAgent,
        uint256 rewardAmount
    );

    event SkillRetired(bytes32 indexed skillId, bytes32 indexed successorId);

    event FitnessUpdated(bytes32 indexed skillId, uint32 newFitnessScore);

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "SkillRegistry: not owner");
        _;
    }

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor() {
        owner = msg.sender;
    }

    // -----------------------------------------------------------------------
    // Core functions
    // -----------------------------------------------------------------------

    /**
     * @notice Register a newly promoted skill genome.
     * @param skillId       UUID of the skill (keccak256 encoded)
     * @param parentId      UUID of the parent (0x0 for genesis skills)
     * @param storageHash   0G Storage content hash / merkle root
     * @param name          Human-readable skill name
     * @param domain        Domain enum value (0-7)
     * @param generation    Mutation generation number
     * @param fitnessScore  Fitness score 0-100
     */
    function registerSkill(
        bytes32 skillId,
        bytes32 parentId,
        string calldata storageHash,
        string calldata name,
        uint8 domain,
        uint32 generation,
        uint32 fitnessScore
    ) external {
        require(
            skills[skillId].createdAt == 0,
            "SkillRegistry: skill already registered"
        );
        require(fitnessScore <= 100, "SkillRegistry: invalid fitness score");
        require(domain <= DOMAIN_GENERAL, "SkillRegistry: invalid domain");
        require(
            bytes(storageHash).length > 0,
            "SkillRegistry: empty storage hash"
        );
        require(bytes(name).length > 0, "SkillRegistry: empty name");

        skills[skillId] = SkillEntry({
            skillId: skillId,
            parentId: parentId,
            originAgent: msg.sender,
            storageHash: storageHash,
            name: name,
            domain: domain,
            generation: generation,
            fitnessScore: fitnessScore,
            usageCount: 0,
            createdAt: uint64(block.timestamp),
            active: true
        });

        _domainIndex[domain].push(skillId);
        totalSkills++;

        // Retire parent if this is a mutation
        if (parentId != bytes32(0) && skills[parentId].createdAt != 0) {
            skills[parentId].active = false;
            emit SkillRetired(parentId, skillId);
        }

        emit SkillRegistered(
            skillId,
            parentId,
            msg.sender,
            name,
            domain,
            generation,
            fitnessScore,
            storageHash
        );
    }

    /**
     * @notice Record that an agent imported a skill (cross-agent pollination).
     *         Issues a micro-reward to the originating agent.
     * @param skillId       The skill being imported
     * @param importingAgent The agent importing the skill
     */
    function recordImport(bytes32 skillId, address importingAgent) external {
        SkillEntry storage skill = skills[skillId];
        require(skill.createdAt != 0, "SkillRegistry: skill not found");
        require(
            importingAgent != skill.originAgent,
            "SkillRegistry: self-import"
        );

        skill.usageCount++;
        pendingRewards[skill.originAgent] += REWARD_PER_IMPORT;

        // Mint reward token if available
        if (skillTokenAddress != address(0)) {
            IERC20Mintable(skillTokenAddress).mint(
                skill.originAgent,
                REWARD_PER_IMPORT
            );
        }

        emit SkillImported(
            skillId,
            importingAgent,
            skill.originAgent,
            REWARD_PER_IMPORT
        );
    }

    /**
     * @notice Update fitness score for an existing skill (callable by originAgent only).
     */
    function updateFitness(bytes32 skillId, uint32 newScore) external {
        require(newScore <= 100, "SkillRegistry: invalid score");
        SkillEntry storage skill = skills[skillId];
        require(skill.createdAt != 0, "SkillRegistry: skill not found");
        require(
            skill.originAgent == msg.sender,
            "SkillRegistry: not originator"
        );

        skill.fitnessScore = newScore;
        emit FitnessUpdated(skillId, newScore);
    }

    // -----------------------------------------------------------------------
    // Query functions
    // -----------------------------------------------------------------------

    /**
     * @notice Get top N active skill IDs for a domain, sorted by fitness (desc).
     *         Paginated: caller provides offset and limit.
     */
    function getTopSkills(
        uint8 domain,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory result, uint256 total) {
        bytes32[] storage all = _domainIndex[domain];
        uint256 activeCount = 0;

        // Count active skills
        for (uint256 i = 0; i < all.length; i++) {
            if (skills[all[i]].active) activeCount++;
        }

        // Collect active skill IDs
        bytes32[] memory active = new bytes32[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < all.length; i++) {
            if (skills[all[i]].active) {
                active[idx++] = all[i];
            }
        }

        // Simple insertion sort by fitnessScore descending (N is small in practice)
        for (uint256 i = 1; i < active.length; i++) {
            bytes32 key = active[i];
            uint32 keyScore = skills[key].fitnessScore;
            int256 j = int256(i) - 1;
            while (
                j >= 0 && skills[active[uint256(j)]].fitnessScore < keyScore
            ) {
                active[uint256(j + 1)] = active[uint256(j)];
                j--;
            }
            active[uint256(j + 1)] = key;
        }

        // Paginate
        uint256 start = offset < active.length ? offset : active.length;
        uint256 end = start + limit < active.length
            ? start + limit
            : active.length;
        result = new bytes32[](end - start);
        for (uint256 i = start; i < end; i++) {
            result[i - start] = active[i];
        }

        return (result, activeCount);
    }

    /**
     * @notice Get full lineage chain for a skill (root → tip).
     */
    function getLineage(
        bytes32 skillId
    ) external view returns (bytes32[] memory chain) {
        uint256 depth = 0;
        bytes32 current = skillId;

        // Count depth
        while (current != bytes32(0) && skills[current].createdAt != 0) {
            depth++;
            current = skills[current].parentId;
        }

        chain = new bytes32[](depth);
        current = skillId;
        for (uint256 i = 0; i < depth; i++) {
            chain[i] = current;
            current = skills[current].parentId;
        }
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    function setSkillToken(address tokenAddress) external onlyOwner {
        skillTokenAddress = tokenAddress;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "SkillRegistry: zero address");
        owner = newOwner;
    }
}
