// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title VibeEscrow
/// @notice Holds dance-match stakes. Players stake equal buy-ins into a
/// matchId bucket, then the authorized backend signer calls settle() with
/// per-address payouts (losers' stakes flow to winners). The per-tick
/// streaming UX is simulated client-side; this contract only records the
/// start (stake) and end (settle) of the game.
contract VibeEscrow is Ownable {
    IERC20 public immutable token;
    address public backend;

    mapping(bytes32 => mapping(address => uint256)) public stakes; // matchId => player => amount
    mapping(bytes32 => uint256) public pools; // matchId => total pool
    mapping(bytes32 => bool) public settled; // matchId => settled?

    event Staked(bytes32 indexed matchId, address indexed player, uint256 amount);
    event Settled(bytes32 indexed matchId, uint256 totalPaid);
    event BackendUpdated(address indexed newBackend);

    error NotBackend();
    error AlreadySettled();
    error AlreadyStaked();
    error AmountZero();
    error InvalidArrays();
    error OverPool();
    error TransferFailed();

    constructor(address _token, address _backend) Ownable(msg.sender) {
        token = IERC20(_token);
        backend = _backend;
    }

    function setBackend(address _backend) external onlyOwner {
        backend = _backend;
        emit BackendUpdated(_backend);
    }

    /// @notice Player stakes into a match. Requires prior ERC20 approval.
    function stake(bytes32 matchId, uint256 amount) external {
        if (amount == 0) revert AmountZero();
        if (settled[matchId]) revert AlreadySettled();
        if (stakes[matchId][msg.sender] != 0) revert AlreadyStaked();
        if (!token.transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }
        stakes[matchId][msg.sender] = amount;
        pools[matchId] += amount;
        emit Staked(matchId, msg.sender, amount);
    }

    /// @notice Backend distributes the pool to winners. Sum of amounts must
    /// not exceed the pool (the complement stays in the escrow; usually
    /// backend passes amounts that sum to the exact pool).
    function settle(
        bytes32 matchId,
        address[] calldata winners,
        uint256[] calldata amounts
    ) external {
        if (msg.sender != backend) revert NotBackend();
        if (settled[matchId]) revert AlreadySettled();
        if (winners.length != amounts.length) revert InvalidArrays();

        settled[matchId] = true;

        uint256 total;
        uint256 pool = pools[matchId];
        for (uint256 i = 0; i < winners.length; i++) {
            uint256 amt = amounts[i];
            if (amt == 0) continue;
            total += amt;
            if (total > pool) revert OverPool();
            if (!token.transfer(winners[i], amt)) revert TransferFailed();
        }
        emit Settled(matchId, total);
    }
}
