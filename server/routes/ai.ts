import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { type AiExtractor, AiOutputError, extractFromDocument } from '../ai';
import { writeAudit } from '../audit';
import { type Db, withTenant } from '../db';
import { HttpError, asyncHandler } from '../errors';
import { requirePermission } from '../rbac';
import { AiParseInput, parse } from '../validation';

/**
 * Extraction IA. Aucun repli fictif : indisponible => erreur explicite.
 * Le résultat n'est JAMAIS persisté ici ; il est renvoyé pour revue humaine (champ requiresHumanValidation).
 */
export function aiRouter(deps: { db: Db; ai?: AiExtractor; log: (e: Record<string, unknown>) => void }): Router {
  const r = Router();
  const limiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.ctx?.identity.clerkId ?? 'anonymous',
    message: { error: 'rate_limited', message: 'Quota horaire d\'analyses IA atteint' },
  });

  r.post('/ai/parse-document', requirePermission('ai:parse'), limiter, asyncHandler(async (req, res) => {
    const input = parse(AiParseInput, req.body);
    if (!deps.ai) throw new HttpError(503, 'ai_not_configured', "L'analyse IA n'est pas configurée sur ce serveur");

    let extraction;
    try {
      extraction = await extractFromDocument(deps.ai, { filename: input.filename, category: input.category ?? 'devis_fournisseur', text: input.text });
    } catch (err) {
      if (err instanceof AiOutputError) {
        deps.log({ level: 'warn', requestId: req.id, event: 'ai_invalid_output', message: err.message });
        throw new HttpError(502, 'ai_invalid_output', "Le modèle a renvoyé une réponse inexploitable. Aucune donnée n'a été extraite.");
      }
      deps.log({ level: 'error', requestId: req.id, event: 'ai_provider_error', message: String((err as Error)?.message ?? err) });
      throw new HttpError(502, 'ai_unavailable', 'Le service d\'analyse IA est momentanément indisponible. Aucune donnée n\'a été extraite.');
    }

    // Traçabilité de l'usage de l'IA (qui, quand, quel document, quel modèle) — sans le contenu du document.
    await withTenant(deps.db, req.ctx!, async (q) => {
      await writeAudit(q, req.ctx!, {
        entity: `Document ${input.filename}`, field: 'Extraction IA',
        newValue: `${extraction.engine.provider}/${extraction.engine.model} — ${extraction.costItems.length} poste(s), ${extraction.carbonItems.length} ligne(s) carbone, non validé`,
      });
    });
    res.json({ success: true, extraction });
  }));

  return r;
}
