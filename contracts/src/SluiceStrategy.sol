// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title SluiceStrategy — the types and flags needed to CALL the deployed router
/// @notice This library deliberately contains NO strategy encoder.
///
///         There is exactly one implementation of program assembly and order encoding,
///         and it is TypeScript: packages/arbitration-sdk/src/swapvm.ts, over the opcode
///         table in config/opcodes.8453.json. That is what the composer runs and what the
///         user ends up signing, so it is what must be exercised on chain.
///
///         `npm run fixtures` writes those bytes to config/fixtures/strategies.json, and
///         the tests and scripts here ship them verbatim. When this file had its own
///         encoder the fork test proved that SOLIDITY's bytes fill — which is not the
///         artifact we ship, so the real one was never tested at all.
///
///         What remains is ABI, not logic: the Order struct exists because swap() and
///         quote() take it, in the same way IERC20 exists because tokens are called.
library SluiceStrategy {
    /// @notice The SwapVM order.
    /// @dev Field order and types must match ISwapVM.Order exactly. In Aqua mode the order
    ///      hash is keccak256(abi.encode(order)), so any divergence silently produces a
    ///      hash that no shipped balance is keyed to — it compiles, it ships, and only the
    ///      fill fails. `traits` is a `type MakerTraits is uint256`, which abi-encodes as
    ///      uint256. The values come from the fixture; nothing here constructs them.
    struct Order {
        address maker;
        uint256 traits;
        bytes data;
    }

    // --- taker traits --------------------------------------------------------
    // Taker-side flags, not strategy encoding, so they are not duplicated from the SDK —
    // the taker is ours and never leaves this repo. TakerTraits is a uint160 read from the
    // first 20 bytes of takerTraitsAndData.

    /// @dev Bit 0. The taker names an exact input amount.
    uint160 internal constant TAKER_EXACT_IN = 0x0001;

    /// @dev Bit 6. THE FLAG THAT MAKES AN EOA TAKER WORK. With it the router does
    ///      safeTransferFrom(taker) -> forceApprove -> AQUA.push itself. Without it the
    ///      router assumes the taker pushed its own side mid-swap (the ITakerCallbacks
    ///      flow) and reverts AquaBalanceInsufficientAfterTakerPush, because Aqua's tokenIn
    ///      balance never grew by amountIn. So a funded EOA plus one approval really is a
    ///      complete taker — but only with this set. F1 §3.
    uint160 internal constant TAKER_USE_TRANSFER_FROM_AND_AQUA_PUSH = 0x0040;

    /// @notice The traits a plain EOA taker uses for an exact-in fill.
    uint160 internal constant TAKER_EOA_EXACT_IN = TAKER_EXACT_IN | TAKER_USE_TRANSFER_FROM_AND_AQUA_PUSH;
}
