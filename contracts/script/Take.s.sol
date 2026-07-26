// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { SluiceStrategy } from "../src/SluiceStrategy.sol";
import { Fixtures } from "../src/Fixtures.sol";

interface IERC20Take {
    function approve(address, uint256) external returns (bool);
}

interface ISwapVMTake {
    function swap(
        SluiceStrategy.Order calldata order,
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bytes calldata takerTraitsAndData
    ) external returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash);

    function quote(
        SluiceStrategy.Order calldata order,
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bytes calldata takerTraitsAndData
    ) external returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash);
}

/// @title Drive a fill against a shipped strategy
/// @notice A fork has no organic takers, so every fill here is one we produce. The taker is
///         a funded EOA plus one approval — NOT a contract, and NOT ITakerCallbacks. See
///         SluiceStrategy.TAKER_USE_TRANSFER_FROM_AND_AQUA_PUSH.
///
///           forge script script/Take.s.sol --rpc-url http://127.0.0.1:8545 \
///             --broadcast --private-key $SLUICE_TAKER_KEY
///
///         The order comes from the same fixture Ship.s.sol used, so nothing is kept in
///         sync by hand: reconstructing it from parameters is how the hash drifts and the
///         fill reverts for an unrelated-looking reason.
contract TakeScript is Script {
    function run() external {
        string memory cfg = vm.readFile("../config/addresses.8453.json");
        address router = vm.parseJsonAddress(cfg, ".swapVMRouter");

        Fixtures.Strategy memory f = Fixtures.load(vm.envOr("SLUICE_FIXTURE", string("usdc-usde-full-range")));
        Fixtures.assertSelfConsistent(f);

        // Default to the fixture's own pair, first token in.
        address tokenIn = vm.envOr("SLUICE_TOKEN_IN", f.tokens[0]);
        address tokenOut = vm.envOr("SLUICE_TOKEN_OUT", f.tokens[1]);
        uint256 amountIn = vm.envOr("SLUICE_AMOUNT_IN", uint256(100e6));

        console.log("fixture       ", f.name);
        console.log("target hash   ", vm.toString(f.strategyHash));

        bytes memory takerTraits = abi.encodePacked(SluiceStrategy.TAKER_EOA_EXACT_IN);

        vm.startBroadcast();
        IERC20Take(tokenIn).approve(router, type(uint256).max);

        // Quote immediately before the swap and record both, so a divergence is visible.
        (, uint256 quotedOut,) = ISwapVMTake(router).quote(f.order, tokenIn, tokenOut, amountIn, takerTraits);
        (uint256 filledIn, uint256 filledOut,) =
            ISwapVMTake(router).swap(f.order, tokenIn, tokenOut, amountIn, takerTraits);
        vm.stopBroadcast();

        console.log("quoted out    ", quotedOut);
        console.log("filled in     ", filledIn);
        console.log("filled out    ", filledOut);
        if (quotedOut != filledOut) console.log("WARNING: quote and swap disagree");
    }
}
