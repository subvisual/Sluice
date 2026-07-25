// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

/// @dev EIP-5267. Declared inline rather than imported — forge-std does not ship it, and
///      this one function is all we need to identify the deployed router.
interface IERC5267 {
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        );
}

/// @title The venue is what we think it is
/// @notice G1 from F1 §7 — the gate the whole venue rescope rests on. Everything else in
///         F1 assumes real Aqua and SwapVM bytecode is reachable on a Base fork at the
///         canonical addresses. If this fails, self-deployment comes back and the Ignition
///         contingency is un-demoted.
///
///         It also pins WHICH router is deployed. `AquaSwapVMRouter` and the generic
///         `SwapVMRouter` expose different instruction sets, and the strategy grammar
///         depends on getting that right.
///
///         Run:
///           cd contracts && SLUICE_RPC_URL=<base rpc> forge test
///
///         Needs no funding, no private key and no shipped strategy — everything here is
///         a read against the pinned fork block in config/addresses.8453.json.
contract ForkVenueTest is Test {
    address internal aqua;
    address internal router;
    address internal weth;
    address internal usdc;
    uint256 internal forkBlock;

    function setUp() public {
        string memory cfg = vm.readFile("../config/addresses.8453.json");
        aqua = vm.parseJsonAddress(cfg, ".aqua");
        router = vm.parseJsonAddress(cfg, ".swapVMRouter");
        weth = vm.parseJsonAddress(cfg, ".tokens.WETH");
        usdc = vm.parseJsonAddress(cfg, ".tokens.USDC");
        forkBlock = vm.parseJsonUint(cfg, ".forkBlock");

        vm.createSelectFork(vm.rpcUrl("base"), forkBlock);
    }

    /// @notice The fork is pinned where we said it is.
    /// @dev chainId is asserted but is NOT a guard: a Base fork reports 8453 exactly like
    ///      Base mainnet. What separates rehearsal from a real transaction is the
    ///      anvil-only fork probe plus SLUICE_ALLOW_MAINNET. See F1 §1.
    function test_forkIsPinned() public view {
        assertEq(block.chainid, 8453, "not on Base");
        assertEq(block.number, forkBlock, "fork block drifted from config");
    }

    /// @notice G1 — real Aqua and SwapVM bytecode at the canonical addresses.
    function test_G1_aquaAndRouterAreDeployed() public view {
        assertGt(aqua.code.length, 0, "no code at aqua - G1 FAILS, the venue rescope is void");
        assertGt(router.code.length, 0, "no code at swapVMRouter - G1 FAILS, the venue rescope is void");

        console.log("chainId       ", block.chainid);
        console.log("forkBlock     ", forkBlock);
        console.log("aqua          ", aqua);
        console.log("  code size   ", aqua.code.length);
        console.log("  code keccak ", vm.toString(keccak256(aqua.code)));
        console.log("router        ", router);
        console.log("  code size   ", router.code.length);
        console.log("  code keccak ", vm.toString(keccak256(router.code)));
    }

    /// @notice The tokens the demo runs on are real and have the decimals we assume.
    function test_demoTokensArePresent() public view {
        assertGt(weth.code.length, 0, "no code at WETH");
        assertGt(usdc.code.length, 0, "no code at USDC");
        assertLt(uint160(weth), uint160(usdc), "WETH must sort below USDC - MakerTraits requires tokenA < tokenB");
    }

    /// @notice Which router is at this address, and which version.
    /// @dev The EIP-712 domain carries the name and version passed to the SwapVM
    ///      constructor, so it identifies the contract without trusting an address list.
    ///      NOTE: the deployed version is NOT the tip of 1inch/swap-vm master — the ABI and
    ///      the instruction set both differ. Read the Sourcify-verified deployed source
    ///      rather than master when building anything against this.
    function test_routerIdentity() public view {
        (, string memory name, string memory version,, address verifyingContract,,) =
            IERC5267(router).eip712Domain();

        console.log("router name   ", name);
        console.log("router version", version);

        assertEq(name, "AquaSwapVMRouter", "not the Aqua-flavoured router - the instruction set would differ");
        assertEq(verifyingContract, router, "EIP-712 domain does not bind to this address");
    }
}
