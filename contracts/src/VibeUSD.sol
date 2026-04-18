// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title VibeUSD
/// @notice Demo stablecoin for VibeCheque. 6 decimals like USDC. Anyone can
/// claim a one-off 10 VUSD airdrop to play. Not for mainnet.
contract VibeUSD is ERC20 {
    uint256 public constant CLAIM_AMOUNT = 10 * 1e6; // 10 VUSD

    mapping(address => bool) public hasClaimed;

    event Claimed(address indexed account);

    error AlreadyClaimed();

    constructor() ERC20("VibeCheque USD", "VUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function claim() external {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();
        hasClaimed[msg.sender] = true;
        _mint(msg.sender, CLAIM_AMOUNT);
        emit Claimed(msg.sender);
    }
}
