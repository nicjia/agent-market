// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/vrf/interfaces/VRFCoordinatorV2Interface.sol";

contract AgentMarket is VRFConsumerBaseV2 {
    enum State {
        OPEN,
        TTL_COUNTDOWN,
        DISPUTE_ACTIVE,
        SETTLED
    }

    struct Task {
        address requester;
        address provider;
        uint256 bounty;
        uint256 challengeFee;
        uint256 providerStake;
        uint64 ttlSeconds;
        uint64 createdAt;
        uint64 lockedAt;
        uint64 disputeStartedAt;
        uint64 commitDeadline;
        uint64 revealDeadline;
        State state;
        bytes32 taskSchemaHash;
        bytes32 payloadHash;
        string payloadCid;
        uint8 votesForProvider;
        uint8 votesForRequester;
        uint8 riskTier;
        bool jurorSelectionReady;
        uint256 vrfRequestId;
    }

    struct DisputeStats {
        uint32 disputes;
        uint32 losses;
    }

    struct JurorVote {
        bytes32 commitHash;
        bool revealed;
        bool valid;
    }

    address public owner;
    address public treasury;
    uint256 public nextTaskId;

    VRFCoordinatorV2Interface public vrfCoordinator;
    bytes32 public vrfKeyHash;
    uint64 public vrfSubId;
    uint16 public vrfConfirmations;
    uint32 public vrfCallbackGasLimit;

    uint256 public baseChallengeBps;
    uint256 public minChallengeFee;
    uint256 public maxRequesterLossBps;
    uint256 public jurorMinStake;
    uint256 public jurorSlashBps;
    uint8 public maxRiskTier;

    uint64 public commitPeriodSeconds;
    uint64 public revealPeriodSeconds;
    uint64 public jurorExitDelaySeconds;

    mapping(uint256 => Task) public tasks;
    mapping(uint256 => address[]) public taskJurors;
    mapping(uint256 => mapping(address => JurorVote)) public jurorVotes;
    mapping(uint256 => uint256) public vrfRequestToTask;

    mapping(address => DisputeStats) public requesterStats;
    mapping(address => DisputeStats) public providerStats;

    address[] public jurorPool;
    mapping(address => bool) public jurorActive;
    mapping(address => uint256) public jurorStake;
    mapping(address => uint64) public jurorExitAt;

    event TaskCreated(uint256 indexed taskId, address indexed requester, uint256 bounty, uint8 riskTier);
    event TaskLocked(uint256 indexed taskId, address indexed provider, bytes32 payloadHash, string payloadCid);
    event TaskChallenged(uint256 indexed taskId, address indexed requester, uint256 challengeFee);
    event JurorSelectionRequested(uint256 indexed taskId, uint256 requestId);
    event JurorSelected(uint256 indexed taskId, address indexed juror);
    event JurorSelectionCompleted(uint256 indexed taskId);
    event JurorCommitted(uint256 indexed taskId, address indexed juror, bytes32 commitHash);
    event JurorRevealed(uint256 indexed taskId, address indexed juror, bool valid);
    event JurorRegistered(address indexed juror, uint256 stake);
    event JurorUnregistered(address indexed juror, uint64 exitAt);
    event JurorSlashed(address indexed juror, uint256 amount, uint256 taskId);
    event TaskSettled(uint256 indexed taskId, bool providerWins);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address treasuryAddress, address vrfCoordinatorAddress) VRFConsumerBaseV2(vrfCoordinatorAddress) {
        owner = msg.sender;
        treasury = treasuryAddress;
        vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorAddress);
        baseChallengeBps = 100;
        minChallengeFee = 0;
        maxRequesterLossBps = 3000;
        jurorMinStake = 0;
        jurorSlashBps = 500;
        maxRiskTier = 3;
        commitPeriodSeconds = 60;
        revealPeriodSeconds = 120;
        jurorExitDelaySeconds = 3600;
        vrfConfirmations = 3;
        vrfCallbackGasLimit = 200000;
    }

    function setTreasury(address treasuryAddress) external onlyOwner {
        treasury = treasuryAddress;
    }

    function setVrfConfig(bytes32 keyHash, uint64 subId, uint16 confirmations, uint32 callbackGasLimit) external onlyOwner {
        vrfKeyHash = keyHash;
        vrfSubId = subId;
        vrfConfirmations = confirmations;
        vrfCallbackGasLimit = callbackGasLimit;
    }

    function setFeeConfig(uint256 baseBps, uint256 minFee, uint256 maxLossBps) external onlyOwner {
        baseChallengeBps = baseBps;
        minChallengeFee = minFee;
        maxRequesterLossBps = maxLossBps;
    }

    function setDisputeWindows(uint64 commitSeconds, uint64 revealSeconds) external onlyOwner {
        commitPeriodSeconds = commitSeconds;
        revealPeriodSeconds = revealSeconds;
    }

    function setJurorConfig(uint256 minStake, uint256 slashBps, uint64 exitDelaySeconds, uint8 maxTier) external onlyOwner {
        jurorMinStake = minStake;
        jurorSlashBps = slashBps;
        jurorExitDelaySeconds = exitDelaySeconds;
        maxRiskTier = maxTier;
    }

    function registerJuror() external payable {
        require(msg.value >= jurorMinStake, "stake too low");
        require(!jurorActive[msg.sender], "already active");

        jurorActive[msg.sender] = true;
        jurorStake[msg.sender] += msg.value;
        jurorPool.push(msg.sender);

        emit JurorRegistered(msg.sender, msg.value);
    }

    function addJurorStake() external payable {
        require(jurorActive[msg.sender], "not active");
        require(msg.value > 0, "no stake");
        jurorStake[msg.sender] += msg.value;
    }

    function unregisterJuror() external {
        require(jurorActive[msg.sender], "not active");
        jurorActive[msg.sender] = false;
        jurorExitAt[msg.sender] = uint64(block.timestamp) + jurorExitDelaySeconds;
        _removeJurorFromPool(msg.sender);

        emit JurorUnregistered(msg.sender, jurorExitAt[msg.sender]);
    }

    function withdrawJurorStake(uint256 amount) external {
        require(!jurorActive[msg.sender], "still active");
        require(block.timestamp >= jurorExitAt[msg.sender], "exit delay");
        require(jurorStake[msg.sender] >= amount, "insufficient stake");

        jurorStake[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }

    function createTask(bytes32 taskSchemaHash, uint256 bounty, uint64 ttlSeconds, uint8 riskTier) external payable returns (uint256) {
        require(msg.value == bounty, "bounty mismatch");
        require(ttlSeconds > 0, "bad ttl");
        require(riskTier <= maxRiskTier, "bad risk");

        uint256 taskId = nextTaskId++;
        tasks[taskId] = Task({
            requester: msg.sender,
            provider: address(0),
            bounty: bounty,
            challengeFee: 0,
            providerStake: 0,
            ttlSeconds: ttlSeconds,
            createdAt: uint64(block.timestamp),
            lockedAt: 0,
            disputeStartedAt: 0,
            commitDeadline: 0,
            revealDeadline: 0,
            state: State.OPEN,
            taskSchemaHash: taskSchemaHash,
            payloadHash: bytes32(0),
            payloadCid: "",
            votesForProvider: 0,
            votesForRequester: 0,
            riskTier: riskTier,
            jurorSelectionReady: false,
            vrfRequestId: 0
        });

        emit TaskCreated(taskId, msg.sender, bounty, riskTier);
        return taskId;
    }

    function acceptAndSubmit(uint256 taskId, bytes32 payloadHash, string calldata payloadCid) external payable {
        Task storage task = tasks[taskId];
        require(task.state == State.OPEN, "not open");
        require(payloadHash != bytes32(0), "bad payload");

        task.provider = msg.sender;
        task.providerStake = msg.value;
        task.payloadHash = payloadHash;
        task.payloadCid = payloadCid;
        task.lockedAt = uint64(block.timestamp);
        task.state = State.TTL_COUNTDOWN;

        emit TaskLocked(taskId, msg.sender, payloadHash, payloadCid);
    }

    function calculateChallengeFee(uint256 taskId) public view returns (uint256) {
        Task storage task = tasks[taskId];
        require(task.state == State.TTL_COUNTDOWN, "not ttl");

        uint256 baseFee = (task.bounty * baseChallengeBps) / 10000;
        if (baseFee < minChallengeFee) {
            baseFee = minChallengeFee;
        }

        uint256 riskBps = uint256(task.riskTier) * 250;
        DisputeStats memory stats = requesterStats[task.requester];
        uint256 lossBps = 0;
        if (stats.disputes > 0) {
            lossBps = (uint256(stats.losses) * 10000) / uint256(stats.disputes);
            if (lossBps > maxRequesterLossBps) {
                lossBps = maxRequesterLossBps;
            }
        }

        uint256 fee = baseFee + ((baseFee * riskBps) / 10000) + ((baseFee * lossBps) / 10000);
        return fee;
    }

    function challenge(uint256 taskId) external payable {
        Task storage task = tasks[taskId];
        require(task.state == State.TTL_COUNTDOWN, "not ttl");
        require(msg.sender == task.requester, "not requester");
        require(block.timestamp < task.lockedAt + task.ttlSeconds, "ttl expired");
        require(jurorPool.length >= 9, "not enough jurors");
        require(vrfKeyHash != bytes32(0), "vrf not set");
        require(vrfSubId != 0, "vrf sub missing");

        uint256 fee = calculateChallengeFee(taskId);
        require(msg.value == fee, "fee mismatch");

        task.challengeFee = fee;
        task.state = State.DISPUTE_ACTIVE;
        task.disputeStartedAt = uint64(block.timestamp);
        task.commitDeadline = uint64(block.timestamp + commitPeriodSeconds);
        task.revealDeadline = uint64(task.commitDeadline + revealPeriodSeconds);

        requesterStats[task.requester].disputes += 1;
        providerStats[task.provider].disputes += 1;

        uint256 requestId = vrfCoordinator.requestRandomWords(
            vrfKeyHash,
            vrfSubId,
            vrfConfirmations,
            vrfCallbackGasLimit,
            1
        );
        vrfRequestToTask[requestId] = taskId;
        task.vrfRequestId = requestId;

        emit JurorSelectionRequested(taskId, requestId);
        emit TaskChallenged(taskId, msg.sender, fee);
    }

    function commitVote(uint256 taskId, bytes32 commitHash) external {
        Task storage task = tasks[taskId];
        require(task.state == State.DISPUTE_ACTIVE, "not dispute");
        require(task.jurorSelectionReady, "jurors not ready");
        require(block.timestamp <= task.commitDeadline, "commit over");
        require(_isJuror(taskId, msg.sender), "not juror");

        JurorVote storage vote = jurorVotes[taskId][msg.sender];
        require(vote.commitHash == bytes32(0), "already committed");
        vote.commitHash = commitHash;

        emit JurorCommitted(taskId, msg.sender, commitHash);
    }

    function revealVote(uint256 taskId, bool valid, bytes32 salt) external {
        Task storage task = tasks[taskId];
        require(task.state == State.DISPUTE_ACTIVE, "not dispute");
        require(task.jurorSelectionReady, "jurors not ready");
        require(block.timestamp >= task.commitDeadline, "commit active");
        require(block.timestamp <= task.revealDeadline, "reveal over");
        require(_isJuror(taskId, msg.sender), "not juror");

        JurorVote storage vote = jurorVotes[taskId][msg.sender];
        require(vote.commitHash != bytes32(0), "no commit");
        require(!vote.revealed, "already revealed");

        bytes32 expected = keccak256(abi.encodePacked(taskId, valid, salt, msg.sender));
        require(expected == vote.commitHash, "bad reveal");

        vote.revealed = true;
        vote.valid = valid;

        if (valid) {
            task.votesForProvider += 1;
        } else {
            task.votesForRequester += 1;
        }

        emit JurorRevealed(taskId, msg.sender, valid);

        if (task.votesForProvider >= 5) {
            _resolve(taskId, true);
        } else if (task.votesForRequester >= 5) {
            _resolve(taskId, false);
        }
    }

    function finalizeDispute(uint256 taskId) external {
        Task storage task = tasks[taskId];
        require(task.state == State.DISPUTE_ACTIVE, "not dispute");
        require(block.timestamp > task.revealDeadline, "reveal active");

        bool providerWins = task.votesForProvider > task.votesForRequester;
        _resolve(taskId, providerWins);
    }

    function settleAfterTTL(uint256 taskId) external {
        Task storage task = tasks[taskId];
        require(task.state == State.TTL_COUNTDOWN, "not ttl");
        require(block.timestamp >= task.lockedAt + task.ttlSeconds, "ttl active");

        task.state = State.SETTLED;
        payable(task.provider).transfer(task.bounty + task.providerStake);

        emit TaskSettled(taskId, true);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        uint256 taskId = vrfRequestToTask[requestId];
        Task storage task = tasks[taskId];
        require(task.state == State.DISPUTE_ACTIVE, "not dispute");

        address[] storage selected = taskJurors[taskId];
        if (selected.length > 0) {
            return;
        }

        uint256 seed = randomWords[0];
        uint256 i = 0;
        while (selected.length < 9 && i < 200) {
            uint256 index = uint256(keccak256(abi.encodePacked(seed, i))) % jurorPool.length;
            address candidate = jurorPool[index];
            if (!_contains(selected, candidate)) {
                selected.push(candidate);
                emit JurorSelected(taskId, candidate);
            }
            i++;
        }

        require(selected.length == 9, "selection failed");
        task.jurorSelectionReady = true;
        emit JurorSelectionCompleted(taskId);
    }

    function _resolve(uint256 taskId, bool providerWins) internal {
        Task storage task = tasks[taskId];
        require(task.state == State.DISPUTE_ACTIVE, "not dispute");

        task.state = State.SETTLED;

        if (providerWins) {
            payable(task.provider).transfer(task.bounty + task.providerStake);
            if (task.challengeFee > 0) {
                payable(treasury).transfer(task.challengeFee);
            }
            requesterStats[task.requester].losses += 1;
        } else {
            payable(task.requester).transfer(task.bounty + task.challengeFee);
            if (task.providerStake > 0) {
                payable(treasury).transfer(task.providerStake);
            }
            providerStats[task.provider].losses += 1;
        }

        _slashJurors(taskId, providerWins);

        emit TaskSettled(taskId, providerWins);
    }

    function _slashJurors(uint256 taskId, bool providerWins) internal {
        address[] storage selected = taskJurors[taskId];
        for (uint256 i = 0; i < selected.length; i++) {
            address juror = selected[i];
            JurorVote storage vote = jurorVotes[taskId][juror];
            bool shouldSlash = false;
            if (!vote.revealed) {
                shouldSlash = true;
            } else if (vote.valid != providerWins) {
                shouldSlash = true;
            }

            if (shouldSlash && jurorStake[juror] > 0) {
                uint256 amount = (jurorStake[juror] * jurorSlashBps) / 10000;
                if (amount > 0) {
                    jurorStake[juror] -= amount;
                    payable(treasury).transfer(amount);
                    emit JurorSlashed(juror, amount, taskId);
                }
            }
        }
    }

    function _removeJurorFromPool(address juror) internal {
        for (uint256 i = 0; i < jurorPool.length; i++) {
            if (jurorPool[i] == juror) {
                jurorPool[i] = jurorPool[jurorPool.length - 1];
                jurorPool.pop();
                break;
            }
        }
    }

    function _contains(address[] storage list, address value) internal view returns (bool) {
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == value) {
                return true;
            }
        }
        return false;
    }

    function _isJuror(uint256 taskId, address juror) internal view returns (bool) {
        address[] storage selected = taskJurors[taskId];
        for (uint256 i = 0; i < selected.length; i++) {
            if (selected[i] == juror) {
                return true;
            }
        }
        return false;
    }
}
