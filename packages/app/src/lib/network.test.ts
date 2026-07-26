import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOCAL_RPC_URL,
  MAINNET_RPC_URL,
  parseRpcMode,
  rpcUrlFor,
} from "./network";

test("parseRpcMode: missing header defaults to local", () => {
  assert.equal(parseRpcMode(null), "local");
  assert.equal(parseRpcMode(undefined), "local");
  assert.equal(parseRpcMode(""), "local");
});

test("parseRpcMode: reads the sluice-rpc cookie", () => {
  assert.equal(parseRpcMode("sluice-rpc=mainnet"), "mainnet");
  assert.equal(parseRpcMode("sluice-rpc=local"), "local");
});

test("parseRpcMode: finds the cookie among others", () => {
  assert.equal(
    parseRpcMode("wagmi.store=abc; sluice-rpc=mainnet; theme=dark"),
    "mainnet",
  );
});

test("parseRpcMode: unknown value falls back to local", () => {
  assert.equal(parseRpcMode("sluice-rpc=goerli"), "local");
  // must not match a longer cookie name that merely ends in sluice-rpc
  assert.equal(parseRpcMode("not-sluice-rpc=mainnet"), "local");
});

test("rpcUrlFor maps modes to the two URLs", () => {
  assert.equal(rpcUrlFor("local"), LOCAL_RPC_URL);
  assert.equal(rpcUrlFor("mainnet"), MAINNET_RPC_URL);
});
