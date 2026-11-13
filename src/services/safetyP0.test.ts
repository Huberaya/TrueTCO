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

test('server mounts the fail-closed integration router and contains no Gemini forwarding implementation', async () => {
  const server = await readFile(new URL('../../server.ts', import.meta.url), 'utf8');
  const router = await readFile(new URL('../server/safetyRoutes.ts', import.meta.url), 'utf8');
  assert.match(server, /createDisabledIntegrationRouter/);
  assert.match(router, /\/api\/erp\/connectors\/:id\/test/);
  assert.match(router, /\/api\/erp\/connectors\/:id\/sync-inbound/);
  assert.match(router, /\/api\/erp\/connectors\/:id\/push-award/);
  assert.match(router, /\/api\/ai\/parse-document/);
  assert.doesNotMatch(server + router, /GEMINI_API_KEY|GoogleGenAI/);
});

test('audit UI does not generate a pretend cryptographic seal or claim legal immutability', async () => {
  const source = await readFile(new URL('../components/AuditLogView.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /auditChainHash|sha256-e3b0|CONFORME ARTICLE L\. 823-10|Signer et Sceller le Visa/);
  assert.match(source, /non certifié/);
});


test('executive report cannot fabricate visas, adjudicate, or claim certification', async () => {
  const source = await readFile(new URL('../components/ExecutiveReportView.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /handleSignVisa|handleAdjudicateProject|reportSealHash|setVisas/);
  assert.match(source, /Adjudication désactivée/);
  assert.match(source, /non certifiée/);
  assert.match(source, /Aucun visa ou sceau n’est émis/);
  assert.doesNotMatch(source, /Document Certifié par le Moteur Algorithmique|Horodatage Immuable|Visa Électronique Apposé/);
});

test('document parser invalidates in-flight results when input changes', async () => {
  const source = await readFile(new URL('../components/AiDocumentParserView.tsx', import.meta.url), 'utf8');
  assert.match(source, /parseRequestId = useRef\(0\)/);
  assert.match(source, /requestId !== parseRequestId\.current/);
  assert.match(source, /invalidateCurrentParse\(\)/);
});

test('ERP UI clears a prior positive award result when the request or payload changes', async () => {
  const source = await readFile(new URL('../components/ErpConnectorsView.tsx', import.meta.url), 'utf8');
  assert.match(source, /setLastAwardResult\(null\);\s*if \(!selectedOfferId\)/);
  assert.match(source, /setLastAwardResult\(null\);\s*setSelectedOfferId/);
  assert.match(source, /setLastAwardResult\(null\);\s*setSelectedErpForAward/);
  assert.match(source, /setLastAwardResult\(null\);\s*setAwardRationale/);
  assert.match(source, /Aucune connexion réelle n’est activée/);
});

test('enterprise login screen does not imply a verified SSO identity or certified audit trail', async () => {
  const source = await readFile(new URL('../components/EnterpriseLoginModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /identité non vérifiée/);
  assert.match(source, /aucun fournisseur d’identité externe n’est vérifié ni connecté/);
  assert.doesNotMatch(source, /Sessions protégées par des jetons cryptographiques de 256 bits|registre d'audit légal|Conforme aux exigences d'isolation/);
});

test('CSRD screen explicitly distinguishes unavailable data from zero emissions or compliance', async () => {
  const source = await readFile(new URL('../components/CsrdTaxonomyView.tsx', import.meta.url), 'utf8');
  assert.match(source, /ne constitue pas un rapport CSRD/);
  assert.match(source, /les zéros ne signifient pas 0 émission/);
  assert.match(source, /Aucun auditeur indépendant/);
});

test('offer entry exposes no synthetic parser result, CSV preview or prefilled verified values', async () => {
  const source = await readFile(new URL('../components/ImportOfferModal.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /handleSimulateQuoteExtraction|EXTRACTED-DEV|Ligne valide détectée|confidenceLevel: 9[0-9]/);
  assert.match(source, /Import CSV\/Excel indisponible/);
  assert.match(source, /Analyse documentaire indisponible/);
  assert.match(source, /justificatif non vérifié/);
  assert.match(source, /confidenceLevel: 0/);
  assert.match(source, /useState<number \| null>\(null\)/);
});

test('document samples start empty, are labeled fictional, and cannot imply active parsing', async () => {
  const view = await readFile(new URL('../components/AiDocumentParserView.tsx', import.meta.url), 'utf8');
  const service = await readFile(new URL('./aiParserService.ts', import.meta.url), 'utf8');
  assert.match(view, /useState<string>\(''\)/);
  assert.match(view, /Exemples fictifs uniquement/);
  assert.match(view, /analyse désactivée/);
  assert.match(service, /Analyse indisponible \(HTTP/);
  assert.doesNotMatch(service, /return Promise\.resolve|confidenceScore:\s*9[0-9]/);
});

test('tenant demo does not claim real residency, legal registration or isolation', async () => {
  const [tenantService, switcher, newTenant] = await Promise.all([
    readFile(new URL('./tenantService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/TenantSwitcher.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/NewTenantModal.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(tenantService, /Organisation de démonstration/);
  assert.match(tenantService, /demo\.invalid/);
  assert.match(tenantService, /Non vérifiée/);
  assert.doesNotMatch(tenantService, /SecNumCloud|849 203 910/);
  assert.match(switcher, /aucune isolation serveur n’est configurée/);
  assert.match(newTenant, /création d’organisation est désactivée/);
  assert.match(newTenant, /Création indisponible : aucune identité vérifiée/);
  assert.doesNotMatch(newTenant, /createTenant\(/);
});

test('server blocks every business API until authentication, RBAC, and tenant isolation are configured', async () => {
  const [server, gate] = await Promise.all([
    readFile(new URL('../../server.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/apiGate.ts', import.meta.url), 'utf8'),
  ]);
  const gateMount = server.indexOf("app.use('/api', createFailClosedApiGate())");
  const firstBusinessRoute = server.indexOf("app.get('/api/tenants'");
  assert.ok(gateMount >= 0 && firstBusinessRoute > gateMount);
  assert.match(gate, /req\.path === '\/health'/);
  assert.match(gate, /status\(503\)/);
  assert.match(gate, /authentification et autorisations serveur non configurées/);
  assert.doesNotMatch(server, /Authentification SSO d entreprise certifiée|success:\s*true,[\s\S]{0,80}token,/);
});

test('client never authenticates a default or cached identity without server verification', async () => {
  const [context, auth] = await Promise.all([
    readFile(new URL('../context/AuthContext.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./authService.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(context, /DEFAULT_ENTERPRISE_USER|auto-provision|setUser\(AuthService\.getCachedUser/);
  assert.doesNotMatch(auth, /fallback to cached user|return this\.getCachedUser\(\)/);
  assert.match(auth, /treating the user as unauthenticated/);
});

test('dashboard no longer presents a live Neon instance or real local demo identity', async () => {
  const [backup, header, app] = await Promise.all([
    readFile(new URL('../components/DataBackupModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/Header.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(backup + header, /NEON LIVE|Instance Neon PostgreSQL Connectée & Migrée|7\/7\)/);
  assert.match(header, /DÉMO/);
  assert.doesNotMatch(app, /Sophie Valéry|Éléonore Chen|u-acheteur|u-rse/);
});

test('audit and backup exports never claim certification, legal immutability, or verified evidence', async () => {
  const [backup, excel, externalities] = await Promise.all([
    readFile(new URL('../components/DataBackupModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./excelExportService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/ExternalitiesAdminView.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(backup, /non immuables ni certifiés/);
  assert.match(backup, /aucune conformité ISO ou piste d’audit légale n’est garantie/);
  assert.match(excel, /EXPORT NON CERTIFIÉ/);
  assert.match(excel, /conservation non garantis/);
  assert.match(externalities, /Non certifié/);
  assert.doesNotMatch(backup + excel + externalities, /100% Immuable|Journal d'audit immuable légal|Horodatage Certifié|Données certifiées de rang A/);
  assert.match(excel, /EXPORT INDICATIF TCO \/ LCC/);
  assert.match(excel, /Source non renseignée/);
  assert.doesNotMatch(excel, /Base Carbone ADEME/);
});
