// Regenerate config/fixtures/strategies.json.  npm run fixtures
import { writeFixtures, buildFixtures } from "./fixtures.ts";
import { formatProgram, fromHex } from "./swapvm.ts";

const path = writeFixtures();
console.log(`wrote ${path}`);
for (const s of buildFixtures().strategies) {
	console.log(`\n${s.name}  (${s.template})`);
	console.log(`  strategyHash ${s.outputs.strategyHash}`);
	console.log(`  program      ${s.outputs.program}`);
	console.log(
		formatProgram(fromHex(s.outputs.program))
			.split("\n")
			.map((l) => `    ${l}`)
			.join("\n"),
	);
}
