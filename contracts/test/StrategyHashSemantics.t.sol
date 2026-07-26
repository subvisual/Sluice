// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";
import { SluiceStrategy } from "../src/SluiceStrategy.sol";
import { Fixtures } from "../src/Fixtures.sol";

interface IERC20H {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IAquaH {
    function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts)
        external
        returns (bytes32 strategyHash);
    function dock(address app, bytes32 strategyHash, address[] calldata tokens) external;
    function safeBalances(address maker, address app, bytes32 strategyHash, address tokenA, address tokenB)
        external
        view
        returns (uint256, uint256);
}

interface ISwapVMH {
    function swap(
        SluiceStrategy.Order calldata order,
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bytes calldata takerTraitsAndData
    ) external returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash);
}

/// @title Does the strategyHash include the maker, or not? Both — at different layers.
/// @notice Settles the question raised on PR #14 (comment 5080104656): our encoder hashes
///         abi.encode(Order) which CONTAINS the maker, while CLAUDE.md says the hash has NO
///         maker in the preimage and collides across makers. Both are right:
///
///         AQUA LAYER — no maker in the preimage. `ship()` computes keccak256(strategy)
///         over the raw bytes; identical bytes shipped by two makers return the IDENTICAL
///         strategyHash (test 2). Nothing collides destructively: the balance rows are
///         keyed [msg.sender][app][hash][token], so the namespacing separates makers, not
///         the hash. So "key on (maker, app, strategyHash)" stands.
///
///         SWAPVM-ORDER LAYER — the maker is inside the bytes. An Aqua-mode strategy's
///         bytes are abi.encode(Order{maker, traits, data}), so two makers composing the
///         IDENTICAL program produce DIFFERENT bytes and different hashes (test 1). For
///         well-formed orders the cross-maker collision never arises.
///
///         The embedded maker is load-bearing: `swap()` reads `order.maker` to pick both
///         the Aqua row and the wallet to pull from. Ship bytes naming someone else and the
///         position is stranded — the fill path only sees the named maker's row (test 3).
contract StrategyHashSemanticsTest is Test {
    string internal constant PUBLIC_BASE_RPC = "https://mainnet.base.org";

    /// @dev MakerTraits bit 254 (Aqua mode) with the receiver (= maker) in the low 160
    ///      bits. Constructed locally because this test probes semantics with orders our
    ///      encoder would never emit (test 3's mismatched maker).
    uint256 internal constant USE_AQUA = 1 << 254;

    address internal aqua;
    address internal router;
    address internal usdc;
    address internal usde;

    address internal maker1 = makeAddr("maker1");
    address internal maker2 = makeAddr("maker2");
    address internal taker = makeAddr("taker");

    bytes internal program; // one identical program for everyone, from the fixture

    address[] internal tokens;
    uint256[] internal amounts;

    function setUp() public {
        string memory cfg = vm.readFile("../config/addresses.8453.json");
        aqua = vm.parseJsonAddress(cfg, ".aqua");
        router = vm.parseJsonAddress(cfg, ".swapVMRouter");
        usdc = vm.parseJsonAddress(cfg, ".tokens.USDC");
        usde = vm.parseJsonAddress(cfg, ".tokens.USDe");
        vm.createSelectFork(vm.envOr("SLUICE_RPC_URL", PUBLIC_BASE_RPC), vm.parseJsonUint(cfg, ".forkBlock"));

        program = Fixtures.load("usdc-usde-full-range").order.data;

        tokens = new address[](2);
        tokens[0] = usdc;
        tokens[1] = usde;
        amounts = new uint256[](2);
        amounts[0] = 10_000e6;
        amounts[1] = 10_000e18;
    }

    function _order(address maker) internal view returns (SluiceStrategy.Order memory) {
        return SluiceStrategy.Order({maker: maker, traits: USE_AQUA | uint160(maker), data: program});
    }

    function _fundAndApprove(address maker) internal {
        deal(usdc, maker, amounts[0]);
        deal(usde, maker, amounts[1]);
        vm.startPrank(maker);
        IERC20H(usdc).approve(aqua, type(uint256).max);
        IERC20H(usde).approve(aqua, type(uint256).max);
        vm.stopPrank();
    }

    /// @notice Identical PROGRAM, different makers -> different bytes -> different hashes.
    /// @dev The maker sits in the hashed bytes twice (Order.maker, and as the receiver in
    ///      the low bits of traits), so the cross-maker collision never arises.
    function test_identicalProgramDifferentMakers_hashesDiffer() public {
        _fundAndApprove(maker1);
        _fundAndApprove(maker2);

        vm.prank(maker1);
        bytes32 h1 = IAquaH(aqua).ship(router, abi.encode(_order(maker1)), tokens, amounts);
        vm.prank(maker2);
        bytes32 h2 = IAquaH(aqua).ship(router, abi.encode(_order(maker2)), tokens, amounts);

        console.log("maker1 hash", vm.toString(h1));
        console.log("maker2 hash", vm.toString(h2));
        assertNotEq(h1, h2, "same program, different makers must hash differently - the maker is in the bytes");
    }

    /// @notice Identical BYTES, different shippers -> the identical hash. Aqua's preimage
    ///         has no maker; the per-maker balance rows are what keep them apart.
    function test_identicalBytesDifferentShippers_sameHash_separateRows() public {
        bytes memory strategyBytes = abi.encode(_order(maker1)); // both ship THESE bytes
        _fundAndApprove(maker1);
        _fundAndApprove(maker2);

        vm.prank(maker1);
        bytes32 h1 = IAquaH(aqua).ship(router, strategyBytes, tokens, amounts);
        vm.prank(maker2);
        bytes32 h2 = IAquaH(aqua).ship(router, strategyBytes, tokens, amounts);

        // The Aqua-layer fact: keccak256(strategy), msg.sender nowhere in it.
        assertEq(h1, h2, "identical bytes must produce the identical strategyHash regardless of shipper");
        assertEq(h1, keccak256(strategyBytes), "the hash is keccak256 of the raw bytes, nothing else");

        // Same hash, two live rows — the namespacing does the separating.
        (uint256 a1,) = IAquaH(aqua).safeBalances(maker1, router, h1, usdc, usde);
        (uint256 a2,) = IAquaH(aqua).safeBalances(maker2, router, h1, usdc, usde);
        assertEq(a1, amounts[0], "maker1's row not live");
        assertEq(a2, amounts[0], "maker2's row not live under the SAME hash");

        // And the burn is per (maker, app, hash): maker2 docking does not touch maker1.
        vm.prank(maker2);
        IAquaH(aqua).dock(router, h1, tokens);
        (a1,) = IAquaH(aqua).safeBalances(maker1, router, h1, usdc, usde);
        assertEq(a1, amounts[0], "maker1's row must survive maker2's dock");
        // For maker2 the same query now REVERTS — safeBalances refuses inactive strategies
        // (SafeBalancesForTokenNotInActiveStrategy) rather than returning zeros. Same hash,
        // same app, opposite answers per maker.
        vm.expectRevert();
        IAquaH(aqua).safeBalances(maker2, router, h1, usdc, usde);
        vm.prank(maker2);
        vm.expectRevert(); // StrategiesMustBeImmutable: a docked hash is burned for THAT maker
        IAquaH(aqua).ship(router, strategyBytes, tokens, amounts);
    }

    /// @notice The embedded maker is load-bearing: a fill against these bytes can only
    ///         ever touch the maker NAMED IN the order. maker2's same-bytes position is
    ///         unreachable by construction.
    function test_fillFollowsTheMakerInsideTheBytes() public {
        bytes memory strategyBytes = abi.encode(_order(maker1));
        _fundAndApprove(maker1);
        _fundAndApprove(maker2);

        vm.prank(maker1);
        IAquaH(aqua).ship(router, strategyBytes, tokens, amounts);
        vm.prank(maker2);
        IAquaH(aqua).ship(router, strategyBytes, tokens, amounts);

        uint256 amountIn = 100e6;
        deal(usdc, taker, amountIn);
        vm.startPrank(taker);
        IERC20H(usdc).approve(router, type(uint256).max);
        // These bytes decode to exactly ONE order, naming maker1. No order a taker could
        // construct reaches maker2's row under this hash: changing the maker field changes
        // the bytes, and the hash.
        (uint256 fIn, uint256 fOut,) = ISwapVMH(router).swap(
            _order(maker1), usdc, usde, amountIn, abi.encodePacked(SluiceStrategy.TAKER_EOA_EXACT_IN)
        );
        vm.stopPrank();

        assertGt(fOut, 0, "the named maker's position must fill");
        assertEq(IERC20H(usdc).balanceOf(maker1), amounts[0] + fIn, "the fill must draw on maker1, the named maker");
        assertEq(IERC20H(usdc).balanceOf(maker2), amounts[0], "maker2's wallet must be untouched by the fill");

        bytes32 h = keccak256(strategyBytes);
        (uint256 a2, uint256 b2) = IAquaH(aqua).safeBalances(maker2, router, h, usdc, usde);
        assertEq(a2, amounts[0], "maker2's virtual USDC must be untouched");
        assertEq(b2, amounts[1], "maker2's virtual USDe must be untouched");
    }
}
