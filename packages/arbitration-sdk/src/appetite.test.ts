import { test } from "node:test";
import assert from "node:assert/strict";
import { appetitePromptBlock, classifyRiskAppetite } from "./appetite.ts";

test("conservative wording classifies as conservative", () => {
	for (const p of [
		"keep it safe, I don't want to lose my stack",
		"a conservative position on my USDC please",
		"low risk market making",
		"be careful with this",
		"preserve my capital while earning a little",
	]) {
		assert.equal(classifyRiskAppetite(p), "conservative", p);
	}
});

test("aggressive wording classifies as aggressive", () => {
	for (const p of [
		"max yield, I can stomach a drawdown",
		"go aggressive on WETH/USDC",
		"full degen mode",
		"I want the risky option",
		"maximise fees, I don't care about the range",
	]) {
		assert.equal(classifyRiskAppetite(p), "aggressive", p);
	}
});

test("neutral when the prompt says nothing about risk", () => {
	for (const p of [
		"market-make WETH/USDC for a week",
		"put my USDC to work",
		"",
		"   ",
	]) {
		assert.equal(classifyRiskAppetite(p), "neutral", JSON.stringify(p));
	}
});

test("a tie reads as neutral rather than picking a side", () => {
	assert.equal(
		classifyRiskAppetite("mostly safe but a little aggressive"),
		"neutral",
	);
});

test("whole words only — 'unsafe' is not 'safe'", () => {
	// Substring matching would read this as conservative, which is backwards.
	assert.notEqual(classifyRiskAppetite("nothing unsafe about it"), "conservative");
});

test("classification is case-insensitive", () => {
	assert.equal(classifyRiskAppetite("KEEP IT SAFE"), "conservative");
	assert.equal(classifyRiskAppetite("Max Yield"), "aggressive");
});

test("the prompt line carries the level and never asks the model to re-derive it", () => {
	const block = appetitePromptBlock("aggressive");
	assert.ok(block.includes("AGGRESSIVE"), block);
	assert.ok(/do NOT re-infer/i.test(block), block);
});
