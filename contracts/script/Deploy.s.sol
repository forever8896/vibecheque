// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VibeUSD} from "../src/VibeUSD.sol";
import {VibeEscrow} from "../src/VibeEscrow.sol";

contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address backend = vm.envAddress("BACKEND_SIGNER_ADDRESS");
        vm.startBroadcast(pk);

        VibeUSD vusd = new VibeUSD();
        VibeEscrow escrow = new VibeEscrow(address(vusd), backend);

        vm.stopBroadcast();

        console2.log("VibeUSD:   ", address(vusd));
        console2.log("VibeEscrow:", address(escrow));
        console2.log("backend:   ", backend);
    }
}
