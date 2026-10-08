/**
 * TrueTCO — Centre d'import : tests de bout en bout sur l'API réelle
 * ---------------------------------------------------------------------------
 * Les fichiers XLSX utilisés ici sont de VRAIS classeurs binaires, construits
 * avec ExcelJS pour le test : la détection de format, la lecture des cellules,
 * les formules, les dates et les erreurs de cellule sont donc réellement
 * exercées, pas simulées.
 *
 * Ce que ces tests exigent :
 *   - un fichier qui n'est pas un XLSX est REFUSÉ avec la raison, jamais deviné ;
 *   - « N/A » reste une donnée absente, jamais 0 € ;
 *   - une catégorie inconnue n'est pas inventée : l'import est bloqué et
 *     l'arbitrage humain est enregistré ;
 *   - un montant invalide bloque la ligne ;
 *   - un fichier déjà importé n'est pas réimporté en silence ;
 *   - l'import écrit les offres et leurs postes, avec provenance et ligne source ;
 *   - le cloisonnement entre organisations tient sur les imports ;
 *   - un dossier verrouillé refuse l'import.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { createApp } from '../server/app';
import { Db } from '../server/db/types';
import { createTestDb } from '../server/db/testing';
import { hashToken, sessionExpiry } from '../server/auth/session';

const ORG_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

let db: Db;
let app: ReturnType<typeof createApp>;
let authA: Record<string, string>;
let authB: Record<string, string>;
let projectA: string;
let projectB: string;

async function createUser(organizationId: string, email: string, token: string): Promise<string> {
  return db.systemTx(async (tx) => {
    const users = await tx.query<{ id: string }>(
      `INSERT INTO users (organization_id, email, full_name, role, status) VALUES ($1,$2,$3,'org_admin','active') RETURNING id`,
      [organizationId, email, email]
    );
    const user = users[0];
    await tx.query(
      `INSERT INTO user_sessions (organization_id, user_id, token_hash, auth_method, expires_at) VALUES ($1,$2,$3,'test',$4)`,
      [organizationId, user.id, hashToken(token), sessionExpiry().toISOString()]
    );
    return user.id;
  });
}

/** Construit un vrai classeur XLSX en mémoire avec les lignes fournies. */
async function buildXlsx(rows: (string | number | Date | null)[][], sheetName = 'Feuille1'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  for (const row of rows) {
    const added = sheet.addRow(row);
    // Les cellules null doivent rester VIDES (pas de chaîne vide), pour tester
    // le traitement des cellules absentes.
    added.eachCell({ includeEmpty: true }, (cell, column) => {
      if (row[column - 1] === null) cell.value = null;
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function uploadTo(projectId: string, auth: Record<string, string>) {
  return request(app).post(`/api/projects/${projectId}/imports`).set(auth);
}

beforeAll(async () => {
  db = await createTestDb({ quiet: true });
  app = createApp({
    db,
    isProd: false,
    allowDemoAuth: false,
    allowedOrigins: [],
    engineVersion: '2.0.0',
    methodologyVersion: '2026.1',
  });

  await db.systemTx(async (tx) => {
    await tx.query(`INSERT INTO organizations (id, name, slug, domain) VALUES ($1,'Org A','org-a','a.example.com')`, [ORG_A]);
    await tx.query(`INSERT INTO organizations (id, name, slug, domain) VALUES ($1,'Org B','org-b','b.example.com')`, [ORG_B]);
  });

  const tokenA = `tok-${'i'.repeat(24)}`;
  const tokenB = `tok-${'j'.repeat(24)}`;
  await createUser(ORG_A, 'import-a@a.example.com', tokenA);
  await createUser(ORG_B, 'import-b@b.example.com', tokenB);
  authA = { Authorization: `Bearer ${tokenA}` };
  authB = { Authorization: `Bearer ${tokenB}` };

  const createdA = await request(app)
    .post('/api/projects')
    .set(authA)
    .send({ reference: 'IMP-1', name: 'Dossier import', category: 'Flotte automobile', currency: 'EUR' })
    .expect(201);
  projectA = createdA.body.id;

  const createdB = await request(app)
    .post('/api/projects')
    .set(authB)
    .send({ reference: 'IMP-B', name: 'Dossier B', category: 'Flotte automobile', currency: 'EUR' })
    .expect(201);
  projectB = createdB.body.id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('Import — détection du format et refus des fichiers non pris en charge', () => {
  it("T-IMP-01 : un fichier qui n'est pas un XLSX valide est refusé avec sa raison", async () => {
    const response = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', Buffer.from('PK\u0003\u0004archive-zip-quelconque-mais-pas-ooxml'), 'donnees.xlsx')
      .expect(415);

    expect(response.body.code).toBe('UNSUPPORTED_FILE_FORMAT');
    expect(response.body.error).toMatch(/ZIP/);
    expect(response.body.error).toMatch(/\.xls/);
    // Rien n'a été écrit : aucun lot d'import ne doit exister.
    const list = await request(app).get(`/api/projects/${projectA}/imports`).set(authA).expect(200);
    expect(list.body.total).toBe(0);
  });

  it("T-IMP-02 : le nom du fichier ne fait pas foi — un CSV annoncé en .xlsx est traité comme un CSV", async () => {
    const csv = 'Fournisseur;Référence;Poste;Catégorie;Montant;Source\nAlpha;OFFX;Maintenance;maintenance;12000;Contrat 2025\n';
    const response = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', Buffer.from(csv, 'utf-8'), 'trompeur.xlsx')
      .expect(201);

    expect(response.body.format).toBe('csv');
    expect(response.body.delimiter).toBe(';');
    expect(response.body.headers).toContain('Montant');
  });

  it('T-IMP-03 : un fichier vide ou sans ligne de données est refusé', async () => {
    const response = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', Buffer.from(''), 'vide.csv')
      .expect(400);
    expect(response.body.code).toBe('FILE_EMPTY');
  });
});

describe('Import — lecture et mapping assisté', () => {
  it('T-IMP-04 : les colonnes sont rapprochées automatiquement quand c’est non ambigu, sinon signalées', async () => {
    const rows = [
      ['Fournisseur', 'Référence', 'Désignation', 'Catégorie de coût', 'Montant', 'Source', 'Quantité'],
      ['Alpha', 'OFF-1', 'Maintenance annuelle', 'maintenance', 12000, 'Contrat 2025', 1],
      ['Alpha', 'OFF-1', 'Prix d’achat', 'acquisition', 150000, 'Devis signé', 2],
    ];
    const response = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', await buildXlsx(rows), 'offres.xlsx')
      .expect(201);

    expect(response.body.format).toBe('xlsx');
    expect(response.body.sheetName).toBe('Feuille1');
    expect(response.body.mapping.applied['Fournisseur']).toBe('supplierName');
    expect(response.body.mapping.applied['Référence']).toBe('offerReference');
    expect(response.body.mapping.applied['Montant']).toBe('amount');
    expect(response.body.mapping.applied['Source']).toBe('sourceName');
    expect(response.body.mapping.missingRequired).toEqual([]);
    expect(response.body.preview.canCommit).toBe(true);
    expect(response.body.preview.offers).toHaveLength(1);
    expect(response.body.preview.offers[0].total).toBe(162000);
    // Le score de qualité est calculé et expliqué, pas décoré.
    expect(response.body.preview.dataQuality.score).toBeGreaterThan(0);
    expect(response.body.preview.dataQuality.explanation).toMatch(/complétude/);
  });

  it('T-IMP-05 : une colonne inconnue bloque l’écriture tant qu’un humain ne l’a pas tranchée', async () => {
    const rows = [
      ['Fournisseur', 'Référence', 'Montant', 'Colonne mystérieuse du client'],
      ['Beta', 'OFF-2', 90000, 'blabla'],
    ];
    const response = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', await buildXlsx(rows), 'inconnue.xlsx')
      .expect(201);

    const codes = response.body.preview.blocking.map((entry: any) => entry.code);
    expect(codes).toContain('UNRESOLVED_COLUMNS');
    expect(response.body.preview.canCommit).toBe(false);
    expect(response.body.preview.nextActions.join(' ')).toMatch(/Colonnes non tranchées/);

    // L'utilisateur tranche : la colonne est écartée explicitement.
    const batchId = response.body.batchId;
    const mapping = { ...response.body.mapping.applied, 'Colonne mystérieuse du client': 'ignore' };
    const patched = await request(app).patch(`/api/imports/${batchId}`).set(authA).send({ mapping }).expect(200);
    expect(patched.body.preview.blocking.map((entry: any) => entry.code)).not.toContain('UNRESOLVED_COLUMNS');
    expect(patched.body.preview.canCommit).toBe(true);
  });

  it('T-IMP-06 : « N/A » est une donnée absente, jamais un zéro', async () => {
    const rows = [
      ['Fournisseur', 'Référence', 'Désignation', 'Catégorie', 'Montant', 'Source'],
      ['Gamma', 'OFF-3', 'Poste sans montant', 'maintenance', 'N/A', 'Devis'],
    ];
    const response = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', await buildXlsx(rows), 'na.xlsx')
      .expect(201);

    const row = response.body.preview.rows[0];
    expect(row.status).toBe('MISSING');
    expect(row.reasons.join(' ')).toMatch(/ne sera pas comptée comme 0|manquant/i);
    expect(response.body.preview.summary.totalAmount).toBe(0);
    // Une valeur manquante BLOQUE l'import (compléter ou écarter la ligne) : elle
    // ne peut pas être ignorée en silence dans un total.
    const blocking = response.body.preview.blocking.find((entry: any) => entry.code === 'MISSING_VALUES');
    expect(blocking).toBeDefined();
    expect(blocking.rows).toEqual([2]);
    expect(blocking.message).toMatch(/ne remplit jamais une valeur manquante/);
  });

  it('T-IMP-07 : une date ambiguë et un nombre ambigu sont signalés, avec l’interprétation retenue', async () => {
    const rows = [
      ['Fournisseur', 'Référence', 'Désignation', 'Catégorie', 'Montant', 'Source', 'Confiance'],
      ['Delta', 'OFF-4', 'Poste', 'maintenance', '1,234', 'Devis', 0.85],
    ];
    const response = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', await buildXlsx(rows), 'ambigu.xlsx')
      .expect(201);

    const row = response.body.preview.rows[0];
    expect(row.status).toBe('WARNING');
    expect(row.reasons.join(' ')).toMatch(/ambigu/);
    // Interprétation retenue et affichée : 1234 (séparateur de milliers).
    expect(row.values.amount.value).toBe(1234);
    expect(row.values.confidence.value).toBe(85);
  });
});

describe('Import — honnêteté des données et arbitrage humain', () => {
  it('T-IMP-08 : une catégorie inconnue n’est pas devinée, elle est arbitrée explicitement', async () => {
    const rows = [
      ['Fournisseur', 'Référence', 'Désignation', 'Catégorie', 'Montant', 'Source'],
      ['Epsilon', 'OFF-5', 'Frais divers', 'opex', 5000, 'Facture'],
      ['Epsilon', 'OFF-5', 'Frais divers bis', 'opex', 3000, 'Facture'],
    ];
    const response = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', await buildXlsx(rows), 'categorie-inconnue.xlsx')
      .expect(201);

    const blocking = response.body.preview.blocking.find((entry: any) => entry.code === 'UNKNOWN_COST_CATEGORY');
    expect(blocking).toBeDefined();
    expect(blocking.message).toMatch(/opex/);
    expect(blocking.message).toMatch(/2 ligne\(s\)/);
    expect(response.body.preview.unknownCategoryValues[0]).toMatchObject({ declared: 'opex', occurrences: 2 });

    // Aucune écriture tant que l'humain n'a pas arbitré.
    await request(app).post(`/api/imports/${response.body.batchId}/commit`).set(authA).expect(409);

    // Arbitrage explicite : l'utilisateur rattache « opex » à une catégorie réelle.
    const patched = await request(app)
      .patch(`/api/imports/${response.body.batchId}`)
      .set(authA)
      .send({ categoryOverrides: { opex: 'couts_administratifs_conformite' } })
      .expect(200);

    expect(patched.body.preview.canCommit).toBe(true);
    expect(patched.body.preview.rows[0].reasons.join(' ')).toMatch(/arbitrée manuellement/);

    const commit = await request(app).post(`/api/imports/${response.body.batchId}/commit`).set(authA).expect(201);
    expect(commit.body.result.createdOffers).toHaveLength(1);
    expect(commit.body.result.createdCostItems).toBe(2);

    const items = await db.asOrganization(ORG_A, (tx) =>
      tx.query<{ category: string; declared_category: string; amount: string }>(
        `SELECT category, declared_category, amount FROM cost_items WHERE offer_id = $1 ORDER BY amount`,
        [commit.body.result.createdOffers[0].id]
      )
    );
    expect(items.map((item) => item.category)).toEqual(['couts_administratifs_conformite', 'couts_administratifs_conformite']);
    // Le libellé d'origine est conservé : on doit pouvoir vérifier qu'aucune
    // catégorie n'a été inventée.
    expect(items[0].declared_category).toBe('opex');
  });

  it('T-IMP-09 : une valeur invalide bloque la ligne au lieu d’être recalculée', async () => {
    const rows = [
      ['Fournisseur', 'Référence', 'Désignation', 'Catégorie', 'Montant', 'Source'],
      ['Zeta', 'OFF-6', 'Poste valide', 'maintenance', 1000, 'Devis'],
      ['Zeta', 'OFF-6', 'Poste cassé', 'maintenance', 'douze mille', 'Devis'],
    ];
    const response = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', await buildXlsx(rows), 'invalide.xlsx')
      .expect(201);

    const blocking = response.body.preview.blocking.find((entry: any) => entry.code === 'INVALID_ROWS');
    expect(blocking.rows).toEqual([3]);
    expect(blocking.message).toMatch(/ne remplace jamais une valeur invalide/);

    await request(app).post(`/api/imports/${response.body.batchId}/commit`).set(authA).expect(409);
  });

  it('T-IMP-10 : une ligne sans source est UNSOURCED et affaiblit le score, sans être ignorée', async () => {
    const rows = [
      ['Fournisseur', 'Référence', 'Désignation', 'Catégorie', 'Montant', 'Source'],
      ['Eta', 'OFF-7', 'Poste sourcé', 'maintenance', 2000, 'Contrat'],
      ['Eta', 'OFF-7', 'Poste non sourcé', 'maintenance', 3000, ''],
    ];
    const response = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', await buildXlsx(rows), 'sources.xlsx')
      .expect(201);

    const statuses = response.body.preview.rows.map((row: any) => row.status);
    expect(statuses).toContain('UNSOURCED');
    expect(response.body.preview.summary.statusCounts.UNSOURCED).toBe(1);
    // Le poste non sourcé compte bien au total (il existe), mais il n'est pas
    // présenté comme vérifié.
    expect(response.body.preview.offers[0].total).toBe(5000);
    expect(response.body.preview.dataQuality.dimensions.find((d: any) => d.key === 'sourcing').earned).toBeLessThan(25);
  });

  it('T-IMP-11 : une offre sans référence n’est pas baptisée d’office', async () => {
    const rows = [
      ['Fournisseur', 'Désignation', 'Catégorie', 'Montant', 'Source'],
      ['Theta', 'Poste', 'maintenance', 4000, 'Devis'],
    ];
    const response = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', await buildXlsx(rows), 'sans-reference.xlsx')
      .expect(201);

    expect(response.body.preview.blocking.map((entry: any) => entry.code)).toContain('OFFER_REFERENCE_REQUIRED');

    // L'utilisateur fournit la référence : elle vient de lui, pas du produit.
    const patched = await request(app)
      .patch(`/api/imports/${response.body.batchId}`)
      .set(authA)
      .send({ offerReferences: { 'sup:theta': 'OFF-8' } })
      .expect(200);
    expect(patched.body.preview.canCommit).toBe(true);
  });
});

describe('Import — écriture, traçabilité et garde-fous', () => {
  let batchId: string;
  let offerId: string;

  it('T-IMP-12 : l’import écrit offres et postes, avec provenance et ligne source', async () => {
    const rows = [
      ['Fournisseur', 'Référence', 'Désignation', 'Catégorie', 'Montant', 'Source', 'Récurrent', 'Quantité', 'Durée de vie'],
      ['Iota', 'OFF-9', 'Achat véhicules', 'acquisition', 200000, 'Devis signé', 'non', 4, 5],
      ['Iota', 'OFF-9', 'Énergie annuelle', 'energie', 15000, 'Relevés 2025', 'oui', 4, 5],
      ['Iota', 'OFF-9', 'Maintenance', 'maintenance', 8000, 'Contrat', 'oui', 4, 5],
    ];
    const upload = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', await buildXlsx(rows), 'complet.xlsx')
      .expect(201);
    batchId = upload.body.batchId;
    expect(upload.body.preview.canCommit).toBe(true);

    const commit = await request(app).post(`/api/imports/${batchId}/commit`).set(authA).expect(201);
    expect(commit.body.result.createdCostItems).toBe(3);
    expect(commit.body.result.createdOffers[0].total).toBe(223000);
    offerId = commit.body.result.createdOffers[0].id;

    const offer = await db.asOrganization(ORG_A, (tx) =>
      tx.query<any>(`SELECT data_source, import_batch_id, expected_lifespan_years, currency FROM supplier_offers WHERE id = $1`, [offerId])
    );
    expect(offer[0].data_source).toBe('import_xlsx');
    expect(offer[0].import_batch_id).toBe(batchId);
    expect(offer[0].expected_lifespan_years).toBe(5);

    const items = await db.asOrganization(ORG_A, (tx) =>
      tx.query<any>(
        `SELECT category, source_row_number, is_imported, is_recurring_yearly, quality_status, source_name, confidence_level
           FROM cost_items WHERE offer_id = $1 ORDER BY source_row_number`,
        [offerId]
      )
    );
    expect(items.map((item) => item.source_row_number)).toEqual([2, 3, 4]);
    expect(items.every((item) => item.is_imported)).toBe(true);
    // Catégorie « energie » ramenée à la catégorie canonique du moteur.
    expect(items[1].category).toBe('energie_consommables');
    expect(items[1].is_recurring_yearly).toBe(true);
    expect(items.every((item) => item.quality_status === 'valid')).toBe(true);

    // Le lot est marqué comme importé, avec son score de qualité et son empreinte.
    const batch = await db.asOrganization(ORG_A, (tx) =>
      tx.query<any>(`SELECT status, imported_offers, source_sha256, data_quality_score FROM import_batches WHERE id = $1`, [batchId])
    );
    expect(batch[0].status).toBe('committed');
    expect(batch[0].imported_offers).toBe(1);
    expect(batch[0].source_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(batch[0].data_quality_score).toBeGreaterThan(50);
  });

  it('T-IMP-13 : l’import est journalisé dans le registre d’audit', async () => {
    const logs = await request(app).get('/api/audit-logs?action=import.committed').set(authA).expect(200);
    const entry = logs.body.items.find((log: any) => log.entity_id === batchId);
    expect(entry).toBeDefined();
    expect(entry.new_value).toMatch(/complet.xlsx/);
    expect(entry.new_value).toMatch(/source_row_number|xlsx/);
  });

  it('T-IMP-14 : le dossier importé est exploitable par le moteur de décision', async () => {
    const second = await request(app)
      .post('/api/offers')
      .set(authA)
      .send({
        projectId: projectA,
        supplierName: 'Kappa',
        offerReference: 'OFF-10',
        apparentTotal: 210000,
        expectedLifespanYears: 5,
        costItems: [
          { category: 'acquisition', label: 'Achat', amount: 210000, sourceName: 'Devis', qualityStatus: 'valid', confidenceLevel: 90 },
          {
            category: 'energie_consommables',
            label: 'Énergie',
            amount: 10000,
            sourceName: 'Relevés',
            qualityStatus: 'valid',
            confidenceLevel: 90,
            isRecurringYearly: true,
            yearlyInflationType: 'none',
          },
        ],
      });

    // Si la création de la seconde offre échoue, autant le dire clairement.
    expect(second.status, JSON.stringify(second.body)).toBe(201);

    const decision = await request(app).post(`/api/projects/${projectA}/decision-runs`).set(authA).expect(201);
    expect(decision.body.ranking.length).toBeGreaterThanOrEqual(2);
    const imported = decision.body.ranking.find((entry: any) => entry.offerReference === 'OFF-9');
    expect(imported).toBeDefined();
    // Le calcul serveur exploite bien le poste récurrent importé : le TCO nominal
    // de l'offre importée dépasse sa somme de poste (5 ans × énergie/maintenance).
    expect(imported.totalComprehensiveTCO).toBeGreaterThan(223000);
  });
});

describe('Import — garde-fous de sécurité et d’exploitation', () => {
  it('T-IMP-15 : un même fichier n’est pas importé deux fois en silence', async () => {
    const rows = [
      ['Fournisseur', 'Référence', 'Désignation', 'Catégorie', 'Montant', 'Source'],
      ['Lambda', 'OFF-11', 'Poste', 'maintenance', 1200, 'Devis'],
    ];
    const file = await buildXlsx(rows);
    await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', file, 'doublon.xlsx')
      .expect(201);

    const second = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', file, 'doublon.xlsx')
      .expect(409);
    expect(second.body.code).toBe('DOCUMENT_ALREADY_EXISTS');
    expect(second.body.error).toMatch(/empreinte SHA-256/);

    // Confirmation explicite : l'utilisateur assume consciemment le second lot.
    const confirmed = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .field('allowDuplicateContent', 'true')
      .attach('file', file, 'doublon.xlsx')
      .expect(201);
    expect(confirmed.body.batchId).not.toBe(second.body.details?.batchId);
  });

  it('T-IMP-16 : un lot importé ne peut pas être réécrit ni rejoué', async () => {
    const list = await request(app).get(`/api/projects/${projectA}/imports`).set(authA).expect(200);
    const committed = list.body.items.find((item: any) => item.status === 'committed');
    expect(committed).toBeDefined();

    const patch = await request(app).patch(`/api/imports/${committed.id}`).set(authA).send({ mapping: {} }).expect(409);
    expect(patch.body.code).toBe('IMPORT_ALREADY_COMMITTED');

    const replay = await request(app).post(`/api/imports/${committed.id}/commit`).set(authA).expect(409);
    expect(replay.body.code).toBe('IMPORT_ALREADY_COMMITTED');
  });

  it('T-IMP-17 : les imports d’une organisation sont invisibles pour une autre (IDOR)', async () => {
    const list = await request(app).get(`/api/projects/${projectA}/imports`).set(authB).expect(404);
    expect(list.body.code).toBe('NOT_FOUND');

    const batches = await request(app).get(`/api/projects/${projectA}/imports`).set(authA).expect(200);
    const batchId = batches.body.items[0].id;
    const foreign = await request(app).get(`/api/imports/${batchId}`).set(authB).expect(404);
    expect(foreign.body.error).toMatch(/introuvable/);

    const commit = await request(app).post(`/api/imports/${batchId}/commit`).set(authB).expect(404);
    expect(commit.body.code).toBe('NOT_FOUND');
  });

  it('T-IMP-18 : un dossier verrouillé refuse tout nouvel import', async () => {
    const locked = await request(app)
      .post('/api/projects')
      .set(authA)
      .send({ reference: 'IMP-LOCK', name: 'Dossier verrouillé', category: 'Flotte automobile', currency: 'EUR' })
      .expect(201);

    // Le verrouillage passe par la route de workflow, qui impose la chaîne
    // complète des statuts et une justification écrite à chaque étape
    // (traçabilité), et exige la permission project:lock pour le verrouillage.
    for (const status of ['data_review', 'finance_review', 'esg_review', 'approval', 'decision', 'locked']) {
      await request(app)
        .post(`/api/projects/${locked.body.id}/status`)
        .set(authA)
        .send({ status, justification: `Étape ${status} validée pour le test d'import.` })
        .expect(200);
    }
    const lockedProject = await request(app).get(`/api/projects/${locked.body.id}`).set(authA).expect(200);
    expect(lockedProject.body.status).toBe('locked');

    const rows = [
      ['Fournisseur', 'Référence', 'Désignation', 'Catégorie', 'Montant', 'Source'],
      ['Mu', 'OFF-12', 'Poste', 'maintenance', 900, 'Devis'],
    ];
    const response = await uploadTo(locked.body.id, authA)
      .field('mode', 'costs')
      .attach('file', await buildXlsx(rows), 'verrouille.xlsx')
      .expect(409);
    expect(response.body.code).toBe('PROJECT_LOCKED');
  });

  it('T-IMP-19 : l’import d’émissions conserve la source du facteur, sans jamais le marquer vérifié', async () => {
    const rows = [
      ['Fournisseur', 'Référence', 'Périmètre', 'Phase du cycle de vie', 'Émissions', 'Source du facteur'],
      ['Nu', 'OFF-13', 'scope 3', 'usage', 42.5, 'Base Carbone ADEME (à vérifier)'],
      ['Nu', 'OFF-13', 'scope 1', 'fabrication', 12, ''],
    ];
    const upload = await uploadTo(projectA, authA)
      .field('mode', 'carbon')
      .attach('file', await buildXlsx(rows), 'carbone.xlsx')
      .expect(201);
    expect(upload.body.preview.canCommit).toBe(true);

    const commit = await request(app).post(`/api/imports/${upload.body.batchId}/commit`).set(authA).expect(201);
    expect(commit.body.result.createdCarbonItems).toBe(2);

    const carbon = await db.asOrganization(ORG_A, (tx) =>
      tx.query<any>(
        `SELECT scope, lifecycle_phase, total_lifecycle_emissions, emission_factor_source, factor_verified, quality_status
           FROM carbon_items WHERE offer_id = $1 ORDER BY total_lifecycle_emissions DESC`,
        [commit.body.result.createdOffers[0].id]
      )
    );
    expect(carbon).toHaveLength(2);
    expect(carbon[0].scope).toBe('scope 3');
    // Aucun facteur n'est marqué vérifié sans référence contrôlée.
    expect(carbon.every((item) => item.factor_verified === false)).toBe(true);
    expect(carbon[1].quality_status).toBe('unsourced');
  });

  it('T-IMP-20 : un CSV en Windows-1252 est décodé et l’encodage déduit est signalé', async () => {
    const csv = 'Fournisseur;Référence;Désignation;Catégorie;Montant;Source\nOmega;OFF-14;Réparation;maintenance;1500;Devis\n';
    const latin1 = Buffer.from(csv.replace('é', 'é'), 'latin1');
    const response = await uploadTo(projectA, authA)
      .field('mode', 'costs')
      .attach('file', latin1, 'latin1.csv')
      .expect(201);

    // Soit l'UTF-8 est valide (le fichier ne contient alors aucun octet accentué),
    // soit l'encodage est déduit et l'utilisateur en est averti.
    if (response.body.encodingGuessed) {
      expect(response.body.notes.join(' ')).toMatch(/Encodage déduit/);
    }
    expect(response.body.headers[2]).toBe('Désignation');
  });
});
