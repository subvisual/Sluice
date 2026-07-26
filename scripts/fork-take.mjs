#!/usr/bin/env node
// Drive a fill against a strategy this wallet already shipped.
//
// A fork has no organic takers, so every fill is one we produce. The order is
// recovered from the `Shipped` event rather than rebuilt from parameters —
// rebuilding is exactly how the bytes drift and the swap reverts for an
// unrelated-looking reason. That also means this works against whatever the UI
// shipped, with nothing kept in sync by hand.
//
//   node scripts/fork-take.mjs --maker 0x… [--hash 0x…] [--in WETH] [--amount 0.02]
//
// Env: SLUICE_RPC (default http://127.0.0.1:8545), SLUICE_TAKER_KEY (default
// anvil account 1). The taker is a funded EOA plus one approval — no contract.

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseUnits,
  formatUnits,
  decodeAbiParameters,
  encodePacked,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(
  readFileSync(join(HERE, "..", "config", "addresses.8453.json"), "utf8"),
);

const RPC = process.env.SLUICE_RPC ?? "http://127.0.0.1:8545";
// anvil account 1 — the taker is deliberately NOT the maker.
const TAKER_KEY =
  process.env.SLUICE_TAKER_KEY ??
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

/// TAKER_EXACT_IN | TAKER_USE_TRANSFER_FROM_AND_AQUA_PUSH — see
/// contracts/src/SluiceStrategy.sol. Bit 6 is what makes an EOA taker work at
/// all; without it the router waits for a push that never comes and reverts.
const TAKER_EOA_EXACT_IN = 0x0041n;

const TOKENS = Object.fromEntries(
  cfg.tokenList.map((t) => [t.symbol, { ...t, address: getAddress(t.address) }]),
);

const aquaAbi = parseAbi([
  "event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)",
  "event Pulled(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
  "event Pushed(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
]);

const routerAbi = parseAbi([
  "struct Order { address maker; uint256 traits; bytes data; }",
  "function quote(Order order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)",
  "function swap(Order order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const maker = arg("maker");
if (!maker) {
  console.error("usage: node scripts/fork-take.mjs --maker 0x… [--hash 0x…] [--in WETH] [--amount 0.02]");
  process.exit(2);
}
const wantHash = arg("hash");
const inSymbol = arg("in", "WETH");
const amountArg = arg("amount", "0.02");

const publicClient = createPublicClient({ transport: http(RPC) });
const taker = privateKeyToAccount(TAKER_KEY);
const walletClient = createWalletClient({ account: taker, transport: http(RPC) });

// A fork of a pinned block starts at that height; anything we shipped is above
// it. Scanning from the pinned block keeps this fast and correct.
const logs = await publicClient.getLogs({
  address: getAddress(cfg.aqua),
  event: aquaAbi[0],
  fromBlock: BigInt(cfg.forkBlock),
  toBlock: "latest",
});

const mine = logs.filter(
  (l) =>
    l.args.maker.toLowerCase() === maker.toLowerCase() &&
    (!wantHash || l.args.strategyHash.toLowerCase() === wantHash.toLowerCase()),
);
if (mine.length === 0) {
  console.error(`no Shipped event for maker ${maker}${wantHash ? ` hash ${wantHash}` : ""} — ship one first`);
  process.exit(1);
}
// Newest wins: re-running after a fresh ship targets what you just shipped.
const shipped = mine[mine.length - 1];
const strategyHash = shipped.args.strategyHash;

// The shipped bytes ARE abi.encode(Order{maker, traits, program}).
const [order] = decodeAbiParameters(
  [
    {
      type: "tuple",
      components: [
        { name: "maker", type: "address" },
        { name: "traits", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
    },
  ],
  shipped.args.strategy,
);

const tokenIn = TOKENS[inSymbol];
const tokenOut = Object.values(TOKENS).find((t) => t.symbol !== inSymbol);
if (!tokenIn || !tokenOut) {
  console.error(`unknown token ${inSymbol} — known: ${Object.keys(TOKENS).join(", ")}`);
  process.exit(2);
}
const amountIn = parseUnits(amountArg, tokenIn.decimals);

const bal = async (token, who) =>
  publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [who] });
const fmt = (v, t) => `${formatUnits(v, t.decimals)} ${t.symbol}`;

console.log(`strategy   ${strategyHash}`);
console.log(`maker      ${order.maker}`);
console.log(`taker      ${taker.address}`);
console.log(`selling    ${fmt(amountIn, tokenIn)} for ${tokenOut.symbol}\n`);

const before = {
  makerIn: await bal(tokenIn, order.maker),
  makerOut: await bal(tokenOut, order.maker),
  takerIn: await bal(tokenIn, taker.address),
  takerOut: await bal(tokenOut, taker.address),
};
if (before.takerIn < amountIn) {
  console.error(
    `taker holds ${fmt(before.takerIn, tokenIn)}, needs ${fmt(amountIn, tokenIn)} — fund it first (scripts/fork-fund.sh)`,
  );
  process.exit(1);
}

const router = getAddress(cfg.swapVMRouter);
const takerTraits = encodePacked(["uint160"], [TAKER_EOA_EXACT_IN]);

// The maker's allowance to Aqua is what makes a shipped position fillable, and
// it is the one precondition that fails LOUDLY on chain and SILENTLY here: the
// curve quotes fine, then `swap` reverts inside Aqua's pull with a bare
// `0xf4059071` from the token's transferFrom. Checked up front so the message
// names the cause instead of leaving a selector to look up.
const makerAllowance = await publicClient.readContract({
  address: tokenOut.address,
  abi: erc20Abi,
  functionName: "allowance",
  args: [order.maker, getAddress(cfg.aqua)],
});
if (makerAllowance === 0n) {
  console.error(
    `the maker has not approved Aqua for ${tokenOut.symbol} — the swap would revert inside\n` +
      `Aqua's pull (0xf4059071 from transferFrom), even though quote() succeeds. Re-approve:\n` +
      `  cast send ${tokenOut.address} "approve(address,uint256)" ${cfg.aqua} \\\n` +
      `    $(cast max-uint) --private-key <maker key> --rpc-url ${RPC}`,
  );
  process.exit(1);
}
const makerOutBalance = await bal(tokenOut, order.maker);
if (makerOutBalance === 0n) {
  console.error(
    `the maker holds no ${tokenOut.symbol} — a shipped ceiling is not inventory, and Aqua can\n` +
      `only pull what is really there. Fund the maker first (see the skill's fund step).`,
  );
  process.exit(1);
}

const approveHash = await walletClient.writeContract({
  chain: null,
  address: tokenIn.address,
  abi: erc20Abi,
  functionName: "approve",
  args: [router, amountIn * 10n],
});
await publicClient.waitForTransactionReceipt({ hash: approveHash });

// Quote immediately before the swap and compare, so a divergence is visible
// rather than inferred.
const { result: quoted } = await publicClient.simulateContract({
  account: taker,
  address: router,
  abi: routerAbi,
  functionName: "quote",
  args: [order, tokenIn.address, tokenOut.address, amountIn, takerTraits],
});

const swapHash = await walletClient.writeContract({
  chain: null,
  address: router,
  abi: routerAbi,
  functionName: "swap",
  args: [order, tokenIn.address, tokenOut.address, amountIn, takerTraits],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
if (receipt.status !== "success") {
  console.error(`swap reverted (tx ${swapHash})`);
  process.exit(1);
}

const after = {
  makerIn: await bal(tokenIn, order.maker),
  makerOut: await bal(tokenOut, order.maker),
  takerIn: await bal(tokenIn, taker.address),
  takerOut: await bal(tokenOut, taker.address),
};

console.log(`quoted out ${fmt(quoted[1], tokenOut)}`);
console.log(`filled out ${fmt(after.takerOut - before.takerOut, tokenOut)}`);
if (quoted[1] !== after.takerOut - before.takerOut) {
  console.log("WARNING: quote and swap disagree");
}
console.log(`\nthis is the moment tokens actually move — the maker's wallet changes here, not at ship:`);
console.log(`  maker  ${tokenIn.symbol}  ${fmt(before.makerIn, tokenIn)} -> ${fmt(after.makerIn, tokenIn)}`);
console.log(`  maker  ${tokenOut.symbol}  ${fmt(before.makerOut, tokenOut)} -> ${fmt(after.makerOut, tokenOut)}`);
console.log(`  taker  ${tokenIn.symbol}  ${fmt(before.takerIn, tokenIn)} -> ${fmt(after.takerIn, tokenIn)}`);
console.log(`  taker  ${tokenOut.symbol}  ${fmt(before.takerOut, tokenOut)} -> ${fmt(after.takerOut, tokenOut)}`);

console.log(`\ntx ${swapHash} (block ${receipt.blockNumber})`);
console.log(
  "\nthe dashboard reflects this only if a subgraph is indexing THIS fork\n" +
    "(subgraph/local/fork-up.sh + SLUICE_SUBGRAPH_URL) — then the card reads\n" +
    "`consumed` against the ceiling. Against the deployed Base subgraph the book\n" +
    "has no record of a fork tx and the card stays at 0, which proves nothing\n" +
    "either way; the balances above are what actually moved.",
);
