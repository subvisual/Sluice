// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";
import { SluiceStrategy } from "../src/SluiceStrategy.sol";
import { Fixtures } from "../src/Fixtures.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

interface IAqua {
    function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts)
        external
        returns (bytes32 strategyHash);
    function safeBalances(address maker, address app, bytes32 strategyHash, address tokenA, address tokenB)
        external
        view
        returns (uint256, uint256);
}

interface ISwapVM {
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

/// @title A composed strategy ships and actually fills — G3
/// @notice F1 §7 item 2, the hard gate: if a fill never lands the project pivots.
///
///         The bytes shipped here are NOT assembled in Solidity. They come from
///         config/fixtures/strategies.json, written by the same TypeScript encoder the
///         composer runs — so this proves the artifact we actually ship will fill, rather
///         than proving it about a second implementation that never leaves the repo.
///
///         USDC/USDe, both dollar-denominated, so a constant-product curve shipped with
///         equal nominal value on each side prices near 1:1 around the middle. The
///         decimals differ (USDC 6dp, USDe 18dp) and that is handled entirely by the
///         virtual amounts — `_xycSwapXD` divides raw balances, so shipping 10_000e6
///         against 10_000e18 IS the 1:1 price. There is no decimals field anywhere.
///
///         Run:  npm --prefix ../packages/arbitration-sdk run fixtures
///               cd contracts && forge test --match-contract StablePairStrategy -vv
contract StablePairStrategyTest is Test {
    string internal constant PUBLIC_BASE_RPC = "https://mainnet.base.org";

    address internal aqua;
    address internal router;
    address internal usdc;
    address internal usde;

    address internal taker = makeAddr("taker");

    function setUp() public {
        string memory cfg = vm.readFile("../config/addresses.8453.json");
        aqua = vm.parseJsonAddress(cfg, ".aqua");
        router = vm.parseJsonAddress(cfg, ".swapVMRouter");
        usdc = vm.parseJsonAddress(cfg, ".tokens.USDC");
        usde = vm.parseJsonAddress(cfg, ".tokens.USDe");

        vm.createSelectFork(vm.envOr("SLUICE_RPC_URL", PUBLIC_BASE_RPC), vm.parseJsonUint(cfg, ".forkBlock"));
    }

    function test_usdeIsPresentWithExpectedDecimals() public view {
        assertGt(usde.code.length, 0, "no code at USDe");
        assertEq(IERC20(usde).decimals(), 18, "USDe is not 18dp");
        assertEq(IERC20(usdc).decimals(), 6, "USDC is not 6dp");
        console.log("USDe symbol", IERC20(usde).symbol());
    }

    /// @notice Solidity's abi.encode(order) agrees with the TypeScript encoder.
    /// @dev The one place the two languages still have to meet. If they ever disagree the
    ///      balances key to a hash no swap can reach, and the only symptom is a fill that
    ///      reverts — so this is asserted before anything touches the chain.
    function test_fixtureEncodingAgreesWithSolidity() public view {
        Fixtures.Strategy memory plain = Fixtures.load("usdc-usde-full-range");
        Fixtures.assertSelfConsistent(plain);
        Fixtures.Strategy memory withFee = Fixtures.load("usdc-usde-full-range-fee");
        Fixtures.assertSelfConsistent(withFee);
        console.log("full-range     ", vm.toString(plain.strategyHash));
        console.log("full-range-fee ", vm.toString(withFee.strategyHash));
    }

    /// @notice Ship a fixture's bytes and fill them from a funded taker EOA.
    /// @dev Shared by both template tests: every template in the grammar goes through
    ///      this exact gate. A template that has not been shipped and filled here does
    ///      not belong in TEMPLATES — that is the membership rule, enforced by usage.
    function _shipAndFill(string memory name) internal returns (uint256 filledOut) {
        Fixtures.Strategy memory fixture = Fixtures.load(name);
        Fixtures.assertSelfConsistent(fixture);
        address maker = fixture.order.maker;

        // --- maker ships -----------------------------------------------------
        // Aqua pulls real ERC20 from the maker's wallet at fill time, so the maker must
        // hold the tokens and have approved Aqua. Tokens never leave until a fill.
        for (uint256 i = 0; i < fixture.tokens.length; i++) {
            deal(fixture.tokens[i], maker, fixture.amounts[i]);
        }

        vm.startPrank(maker);
        for (uint256 i = 0; i < fixture.tokens.length; i++) {
            IERC20(fixture.tokens[i]).approve(aqua, type(uint256).max);
        }
        bytes32 shipped = IAqua(aqua).ship(router, fixture.strategy, fixture.tokens, fixture.amounts);
        vm.stopPrank();

        // The hash was computable off-chain, before the user signed anything.
        assertEq(shipped, fixture.strategyHash, "shipped hash != the hash the composer predicted");

        (uint256 bIn, uint256 bOut) = IAqua(aqua).safeBalances(maker, router, shipped, usdc, usde);
        assertEq(bIn, fixture.amounts[0], "USDC virtual balance not shipped");
        assertEq(bOut, fixture.amounts[1], "USDe virtual balance not shipped");

        // --- taker fills -----------------------------------------------------
        uint256 amountIn = 100e6; // 100 USDC in
        deal(usdc, taker, amountIn);

        bytes memory takerTraits = abi.encodePacked(SluiceStrategy.TAKER_EOA_EXACT_IN);

        vm.startPrank(taker);
        IERC20(usdc).approve(router, type(uint256).max);

        // Quote immediately before the swap and record both. F1 §3 job 2.
        (, uint256 quotedOut,) = ISwapVM(router).quote(fixture.order, usdc, usde, amountIn, takerTraits);

        uint256 filledIn;
        (filledIn, filledOut,) = ISwapVM(router).swap(fixture.order, usdc, usde, amountIn, takerTraits);
        vm.stopPrank();

        console.log("fixture    ", name);
        console.log("quoted out ", quotedOut);
        console.log("filled out ", filledOut);

        assertEq(filledIn, amountIn, "taker paid something other than the exact-in amount");
        assertGt(filledOut, 0, "no tokens out - the strategy did not fill");
        assertEq(filledOut, quotedOut, "quote and swap disagree");

        // Constant product on a balanced stable pair: ~1:1 less curve slippage. 100 USDC
        // into a 10k/10k pool returns a shade under 100 USDe.
        assertLt(filledOut, 100e18, "output exceeded 1:1 - the curve is not doing what we think");
        assertGt(filledOut, 98e18, "output far below 1:1 - check the virtual amounts");

        // The tokens really moved. This is what the bounty asks be shown on stage.
        assertEq(IERC20(usde).balanceOf(taker), filledOut, "taker did not receive USDe");
        assertEq(IERC20(usdc).balanceOf(maker), fixture.amounts[0] + filledIn, "maker did not receive USDC");
    }

    /// @notice The plain full-range template ships and fills. 100 USDC -> ~99.0099 USDe.
    function test_G3_shipAndFill() public {
        _shipAndFill("usdc-usde-full-range");
    }

    /// @notice The fee template ships and fills, and the fee demonstrably bites.
    /// @dev 0.05% input-side fee: the curve prices on 99.95 USDC instead of 100, so the
    ///      output must land strictly below the no-fee fill of the same size. This is the
    ///      test the grammar's "proven to fill" claim for full-range-fee rests on.
    function test_G3_shipAndFill_feeTemplate() public {
        uint256 noFeeOut = 99009900990099009900; // the plain template's fill, asserted above
        uint256 feeOut = _shipAndFill("usdc-usde-full-range-fee");
        assertLt(feeOut, noFeeOut, "fee template returned no less than the no-fee fill - the fee did nothing");
    }
}
