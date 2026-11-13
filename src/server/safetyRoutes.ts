import { Router, type Request, type Response } from "express";

const unavailableIntegration =
	(integration: string) => (_req: Request, res: Response) =>
		res.status(503).json({
			success: false,
			error: `${integration} non configuré : aucun service réel n'est relié. Aucune opération n'a été exécutée.`,
			message: `${integration} non configuré. Aucune opération n'a été exécutée.`,
		});

/** Fail closed until authenticated, audited integrations are actually configured. */
export function createDisabledIntegrationRouter(): Router {
	const router = Router();
	router.post(
		"/api/erp/connectors/:id/test",
		unavailableIntegration("Test ERP"),
	);
	router.post(
		"/api/erp/connectors/:id/sync-inbound",
		unavailableIntegration("Import ERP"),
	);
	router.post(
		"/api/erp/connectors/:id/push-award",
		unavailableIntegration("Transmission ERP"),
	);
	router.post("/api/ai/parse-document", (_req: Request, res: Response) =>
		res.status(503).json({
			success: false,
			error:
				"Analyse documentaire désactivée : authentification, consentement explicite et protections de traitement externe ne sont pas configurés. Le document n’a pas été transmis.",
			message:
				"Analyse documentaire désactivée. Le document n’a pas été transmis.",
		}),
	);
	return router;
}
