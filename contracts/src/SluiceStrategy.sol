// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title SluiceStrategy — the types and flags needed to CALL the deployed router
/// @notice Contains NO strategy encoder. The one encoder is TypeScript
///         (packages/arbitration-sdk/src/swapvm.ts, over config/opcodes.8453.json) — what
///         the composer runs and the user signs, so it is what must be exercised on chain.
///         `npm run fixtures` writes those bytes to config/fixtures/strategies.json and the
///         tests and scripts here ship them verbatim. What remains here is ABI, not logic:
///         the Order struct exists because swap() and quote() take it.
library SluiceStrategy {
    /// @notice The SwapVM order.
    /// @dev Field order and types must match ISwapVM.Order exactly. In Aqua mode the order
    ///      hash is keccak256(abi.encode(order)), so any divergence produces a hash no
    ///      shipped balance is keyed to: it ships fine and only the fill fails. `traits`
    ///      abi-encodes as uint256. Values come from the fixture.
    struct Order {
        address maker;
        uint256 traits;
        bytes data;
    }

    // --- taker traits --------------------------------------------------------
    // Taker-side flags, not strategy encoding. TakerTraits is a uint160 read from the first
    // 20 bytes of takerTraitsAndData.

    /// @dev Bit 0. The taker names an exact input amount.
    uint160 internal constant TAKER_EXACT_IN = 0x0001;

    /// @dev Bit 6. THE FLAG THAT MAKES AN EOA TAKER WORK. With it the router does
    ///      safeTransferFrom(taker) -> forceApprove -> AQUA.push itself. Without it the
    ///      router assumes the taker pushed its own side (the ITakerCallbacks flow) and
    ///      reverts AquaBalanceInsufficientAfterTakerPush. A funded EOA plus one approval is
    ///      a complete taker only with this set.
    uint160 internal constant TAKER_USE_TRANSFER_FROM_AND_AQUA_PUSH = 0x0040;

    /// @notice The traits a plain EOA taker uses for an exact-in fill.
    uint160 internal constant TAKER_EOA_EXACT_IN = TAKER_EXACT_IN | TAKER_USE_TRANSFER_FROM_AND_AQUA_PUSH;
}
