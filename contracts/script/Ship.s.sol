// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { Fixtures } from "../src/Fixtures.sol";

interface IERC20Ship {
    function approve(address, uint256) external returns (bool);
}

interface IAquaShip {
    function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts)
        external
        returns (bytes32);
}

/// @title Ship a strategy produced by the TypeScript composer
/// @notice The maker signs this. Tokens never leave the wallet: Aqua records virtual
///         balances and pulls the real ERC20 only when a taker fills.
///
///         The bytes are NOT built here. Regenerate them first, then ship:
///           npm --prefix ../packages/arbitration-sdk run fixtures
///           anvil --fork-url $SLUICE_RPC_URL --fork-block-number <forkBlock from config>
///           forge script script/Ship.s.sol --rpc-url http://127.0.0.1:8545 \
///             --broadcast --private-key $SLUICE_MAKER_KEY
///
///         SLUICE_FIXTURE selects which strategy. Take.s.sol reads the same one, so routing
///         both through the fixture (not matching constructor args) is what stops them
///         drifting.
contract ShipScript is Script {
    function run() external {
        string memory cfg = vm.readFile("../config/addresses.8453.json");
        address aqua = vm.parseJsonAddress(cfg, ".aqua");
        address router = vm.parseJsonAddress(cfg, ".swapVMRouter");

        Fixtures.Strategy memory f = Fixtures.load(vm.envOr("SLUICE_FIXTURE", string("usdc-usde-full-range")));
        Fixtures.assertSelfConsistent(f);

        console.log("fixture       ", f.name);
        console.log("maker         ", f.order.maker);
        console.log("program       ", vm.toString(f.order.data));
        console.log("expected hash ", vm.toString(f.strategyHash));
        require(f.order.maker == msg.sender, "maker in fixture != broadcasting key - the hash would differ");

        vm.startBroadcast();
        // Aqua pulls from the maker's wallet at fill time, so the allowance is what makes
        // the position fillable: without it the strategy ships and every fill reverts.
        for (uint256 i = 0; i < f.tokens.length; i++) {
            IERC20Ship(f.tokens[i]).approve(aqua, type(uint256).max);
        }
        bytes32 shipped = IAquaShip(aqua).ship(router, f.strategy, f.tokens, f.amounts);
        vm.stopBroadcast();

        console.log("SHIPPED       ", vm.toString(shipped));
        require(shipped == f.strategyHash, "hash mismatch - the fixture is stale, rerun `npm run fixtures`");
    }
}
