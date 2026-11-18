import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createDisabledIntegrationRouter } from "./safetyRoutes";

test("API routes fail closed without fabricating ERP results or forwarding documents", async () => {
	const app = express();
	app.use(express.json({ limit: "1mb" }));
	app.use(createDisabledIntegrationRouter());
	const server = createServer(app);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address() as AddressInfo;
	const baseUrl = `http://127.0.0.1:${address.port}`;

	try {
		const routes = [
			["/api/erp/connectors/sap/test", {}],
			["/api/erp/connectors/sap/sync-inbound", { projectId: "project-1" }],
			[
				"/api/erp/connectors/sap/push-award",
				{ projectId: "project-1", offerId: "offer-1" },
			],
		] as const;
		for (const [route, body] of routes) {
			const response = await fetch(`${baseUrl}${route}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			const data = await response.json();
			assert.equal(response.status, 503, route);
			assert.equal(data.success, false, route);
			assert.doesNotMatch(
				JSON.stringify(data),
				/poReference|offersImported|AUTHENTICATED/i,
				route,
			);
		}

		const sensitiveDocument = "private-test-document-should-not-be-forwarded";
		const parseResponse = await fetch(`${baseUrl}/api/ai/parse-document`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				filename: "private.txt",
				category: "devis_fournisseur",
				text: sensitiveDocument,
			}),
		});
		const parseResult = await parseResponse.json();
		assert.equal(parseResponse.status, 503);
		assert.equal(parseResult.success, false);
		assert.match(parseResult.error, /n’a pas été transmis/);
		assert.equal(
			JSON.stringify(parseResult).includes(sensitiveDocument),
			false,
		);
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});
