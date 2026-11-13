import assert from "node:assert/strict";
import test from "node:test";
import { runAllTCOEngineTests } from "./tcoEngine.test";

test("TCO engine regression assertions all pass", () => {
	const result = runAllTCOEngineTests();
	assert.equal(
		result.failed,
		0,
		result.results
			.filter((item) => !item.passed)
			.map((item) => `${item.id}: ${item.actual}`)
			.join("\n"),
	);
	assert.equal(result.passed, result.total);
});
