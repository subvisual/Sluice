// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Vm } from "forge-std/Vm.sol";
import { SluiceStrategy } from "./SluiceStrategy.sol";

/// @title Read strategies produced by the TypeScript encoder
/// @notice The contracts do not build strategies. `npm run fixtures` writes the composer's
///         own bytes to config/fixtures/strategies.json and this reads them back, so what
///         ships on the fork is byte-identical to what a user would sign. Deserialization
///         only: no assembly here, or the single-source-of-truth property is gone.
library Fixtures {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    string internal constant PATH = "../config/fixtures/strategies.json";

    struct Strategy {
        string name;
        SluiceStrategy.Order order;
        bytes strategy; // abi.encode(order) — the bytes Aqua's ship() hashes
        bytes32 strategyHash;
        address[] tokens;
        uint256[] amounts;
    }

    /// @notice Load one fixture by name.
    /// @dev Reverts if the name is absent rather than returning an empty strategy: a
    ///      silently empty program would ship fine and only fail at fill time.
    function load(string memory name) internal view returns (Strategy memory s) {
        string memory json = vm.readFile(PATH);
        string memory base = string.concat(".strategies[?(@.name == '", name, "')]");

        s.name = name;
        s.strategy = vm.parseJsonBytes(json, string.concat(base, ".outputs.strategy"));
        s.strategyHash = vm.parseJsonBytes32(json, string.concat(base, ".outputs.strategyHash"));
        s.tokens = vm.parseJsonAddressArray(json, string.concat(base, ".inputs.tokens"));
        s.amounts = vm.parseJsonUintArray(json, string.concat(base, ".inputs.amounts"));

        s.order = SluiceStrategy.Order({
            maker: vm.parseJsonAddress(json, string.concat(base, ".inputs.maker")),
            traits: vm.parseJsonUint(json, string.concat(base, ".outputs.traits")),
            data: vm.parseJsonBytes(json, string.concat(base, ".outputs.program"))
        });

        require(s.strategy.length > 0, "Fixtures: no such strategy - run `npm run fixtures`");
        require(s.tokens.length == s.amounts.length, "Fixtures: tokens/amounts length mismatch");
    }

    /// @notice The order carried in the fixture really does hash to the recorded hash.
    /// @dev Catches a drift between the TypeScript abi.encode and Solidity's. If they
    ///      disagree the fill fails for a reason that looks nothing like the cause, so
    ///      assert it up front.
    function assertSelfConsistent(Strategy memory s) internal pure {
        require(keccak256(s.strategy) == s.strategyHash, "Fixtures: strategyHash != keccak256(strategy)");
        require(
            keccak256(abi.encode(s.order)) == s.strategyHash,
            "Fixtures: abi.encode(order) disagrees with the TypeScript encoder"
        );
    }
}
