import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AiParserService } from './aiParserService';
import { CsrdTaxonomyService } from './csrdTaxonomyService';
import { ErpService, INITIAL_ERP_CONNECTORS, INITIAL_ERP_LOGS } from './erpService';
import { SignatureService } from './signatureService';

test('document parser rejects unavailable service rather than synthesizing extracted facts', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'disabled' }), { status: 503 });
  try {
    await assert.rejects(
      AiParserService.parseDocument({ filename: 'offre.txt', content: 'Renault 50', category: 'devis_fournisseur' }),
      /disabled/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ERP fixture does not claim live connections, imported offers, awards or past success logs', () => {
  assert.equal(INITIAL_ERP_CONNECTORS.some((item) => item.status === 'connected'), false);
  assert.equal(INITIAL_ERP_CONNECTORS.every((item) => item.inboundOffersCount === 0 && item.outboundAwardsCount === 0), true);
  assert.deepEqual(INITIAL_ERP_LOGS, []);
});

test('ERP import and award report failure without returning a synthetic offer or PO', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'disabled' }), { status: 503 });
  try {
    const inbound = await ErpService.syncInboundOffers('erp-sap-ariba', 'project-1');
    const award = await ErpService.pushAwardDecision('erp-sap-ariba', 'project-1', 'offer-1', 'test');
    assert.equal(inbound.success, false);
    assert.equal(inbound.offers.length, 0);
    assert.equal(award.success, false);
    assert.equal(award.poReference, '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CSRD report is clearly unavailable and contains no invented activity or assurance', () => {
  const report = CsrdTaxonomyService.generateReport([], [], 2026);
  assert.equal(report.auditorVerificationStatus, 'donnees_insuffisantes');
  assert.equal(report.activities.length, 0);
  assert.equal(report.independentAuditorName, '');
});

test('signature draft has no fabricated signatures/hash and local signing is disabled', () => {
  const draft = SignatureService.getCertificate('project-1');
  assert.equal(draft.isFullyExecuted, false);
  assert.equal(draft.signatures.length, 0);
  assert.equal(draft.sealedHash, '');
  assert.throws(() => SignatureService.signRole('project-1', 'acheteur', 'A', 'B', 'a@example.invalid', 'test'), /désactivée/);
});

test('server rejects all unconfigured ERP/document operations and will not forward documents to Gemini', async () => {
  const source = await readFile(new URL('../../server.ts', import.meta.url), 'utf8');
  assert.match(source, /app\.post\('\/api\/erp\/connectors\/:id\/test', unavailableIntegration/);
  assert.match(source, /app\.post\('\/api\/erp\/connectors\/:id\/sync-inbound', unavailableIntegration/);
  assert.match(source, /app\.post\('\/api\/erp\/connectors\/:id\/push-award', unavailableIntegration/);
  assert.match(source, /Analyse documentaire désactivée/);
  assert.doesNotMatch(source, /GEMINI_API_KEY/);
});

test('audit UI does not generate a pretend cryptographic seal or claim legal immutability', async () => {
  const source = await readFile(new URL('../components/AuditLogView.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /auditChainHash|sha256-e3b0|CONFORME ARTICLE L\. 823-10|Signer et Sceller le Visa/);
  assert.match(source, /non certifié/);
});
