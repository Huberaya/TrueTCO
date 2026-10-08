/**
 * TESTS D'ISOLATION MULTI-TENANT (P0)
 * ---------------------------------------------------------------------------
 * Ces tests s'exécutent sur un VRAI moteur PostgreSQL (PGlite/WASM, PostgreSQL
 * 18) avec les VRAIES policies RLS de production. Ils ne testent pas une
 * imitation du cloisonnement : si la policy est mal écrite, ces tests échouent.
 *
 * Scénarios couverts :
 *   1. Lecture croisée interdite (SELECT avec l'identifiant exact de l'autre org)
 *   2. Écriture croisée interdite (INSERT/UPDATE avec l'organization_id d'autrui)
 *   3. Fuite par jointure interdite (postes de coût rattachés à l'offre d'autrui)
 *   4. Absence de contexte → refus de tout (échec fermé, pas d'accès par défaut)
 *   5. Journal d'audit : lecture cloisonnée, modification impossible
 *   6. Résolution de session : la fonction SECURITY DEFINER ne renvoie que la
 *      session demandée et rien d'autre
 *   7. Contournement par requête volontairement non filtrée (simulation d'un bug
 *      applicatif : `SELECT * FROM projects` sans WHERE)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../server/db/testing';
import { Db, Executor } from '../server/db/types';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let db: Db;

async function seed(tx: Executor, orgId: string, label: string): Promise<{ projectId: string; supplierId: string; offerId: string }> {
  const [project] = await tx.query<{ id: string }>(
    `INSERT INTO projects (organization_id, reference, name, category, created_by)
     VALUES ($1, $2, $3, 'Test', NULL) RETURNING id`,
    [orgId, `REF-${label}`, `Dossier ${label}`]
  );
  const [supplier] = await tx.query<{ id: string }>(
    `INSERT INTO suppliers (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, `Fournisseur ${label}`]
  );
  const [offer] = await tx.query<{ id: string }>(
    `INSERT INTO supplier_offers (organization_id, project_id, supplier_id, supplier_name, offer_reference, apparent_total)
     VALUES ($1, $2, $3, $4, $5, 1000) RETURNING id`,
    [orgId, project.id, supplier.id, `Fournisseur ${label}`, `OFF-${label}`]
  );
  await tx.query(
    `INSERT INTO cost_items (organization_id, offer_id, category, label, amount, quality_status, confidence_level)
     VALUES ($1, $2, 'acquisition', 'Prix', 1000, 'valid', 90)`,
    [orgId, offer.id]
  );
  return { projectId: project.id, supplierId: supplier.id, offerId: offer.id };
}

beforeAll(async () => {
  db = await createTestDb({ quiet: true });
  await db.systemTx(async (tx) => {
    for (const [orgId, name, slug, domain] of [
      [ORG_A, 'Organisation A', 'org-a', 'a.example.com'],
      [ORG_B, 'Organisation B', 'org-b', 'b.example.com'],
    ]) {
      await tx.query(
        `INSERT INTO organizations (id, name, slug, domain) VALUES ($1, $2, $3, $4)`,
        [orgId, name, slug, domain]
      );
    }
    await seed(tx, ORG_A, 'A');
    await seed(tx, ORG_B, 'B');
  });
});

afterAll(async () => {
  await db?.close();
});

describe('Isolation multi-tenant (RLS PostgreSQL)', () => {
  it('T-ISO-01 : un SELECT non filtré ne renvoie QUE les données de l’organisation active', async () => {
    const rowsA = await db.asOrganization(ORG_A, (tx) => tx.query('SELECT reference FROM projects'));
    expect(rowsA.map((r: any) => r.reference)).toEqual(['REF-A']);

    const rowsB = await db.asOrganization(ORG_B, (tx) => tx.query('SELECT reference FROM projects'));
    expect(rowsB.map((r: any) => r.reference)).toEqual(['REF-B']);
  });

  it('T-ISO-02 : l’accès par identifiant exact à la ressource d’une autre organisation ne renvoie rien (IDOR)', async () => {
    const projectB = await db.systemTx((tx) =>
      tx.query<{ id: string }>(`SELECT id FROM projects WHERE reference = 'REF-B'`)
    );
    const targetId = projectB[0].id;

    const asA = await db.asOrganization(ORG_A, (tx) =>
      tx.query('SELECT id, reference FROM projects WHERE id = $1', [targetId])
    );
    expect(asA).toHaveLength(0);

    // Une mise à jour ciblée sur l'identifiant d'autrui ne touche aucune ligne.
    const updated = await db.asOrganization(ORG_A, (tx) =>
      tx.query('UPDATE projects SET name = $$piraté$$ WHERE id = $1 RETURNING id', [targetId])
    );
    expect(updated).toHaveLength(0);

    const stillB = await db.asOrganization(ORG_B, (tx) =>
      tx.query<{ name: string }>('SELECT name FROM projects WHERE id = $1', [targetId])
    );
    expect(stillB[0].name).toBe('Dossier B');
  });

  it('T-ISO-03 : une suppression ciblée sur une autre organisation ne supprime rien', async () => {
    const projectB = await db.systemTx((tx) =>
      tx.query<{ id: string }>(`SELECT id FROM projects WHERE reference = 'REF-B'`)
    );
    const deleted = await db.asOrganization(ORG_A, (tx) =>
      tx.query('DELETE FROM projects WHERE id = $1 RETURNING id', [projectB[0].id])
    );
    expect(deleted).toHaveLength(0);
  });

  it('T-ISO-04 : impossible d’insérer une ligne au nom d’une autre organisation', async () => {
    await expect(
      db.asOrganization(ORG_A, (tx) =>
        tx.query(
          `INSERT INTO projects (organization_id, reference, name, category)
           VALUES ($1, 'REF-FRAUDE', 'Injecté', 'Test')`,
          [ORG_B]
        )
      )
    ).rejects.toThrow(/policy|refus|interdit/i);
  });

  it('T-ISO-05 : impossible de déplacer une ligne vers une autre organisation (WITH CHECK)', async () => {
    await expect(
      db.asOrganization(ORG_A, (tx) =>
        tx.query(`UPDATE projects SET organization_id = $1 WHERE reference = 'REF-A'`, [ORG_B])
      )
    ).rejects.toThrow(/policy|refus|interdit/i);
  });

  it('T-ISO-06 : les tables filles (postes de coût) sont cloisonnées même par jointure', async () => {
    const offerB = await db.systemTx((tx) =>
      tx.query<{ id: string }>(`SELECT id FROM supplier_offers WHERE offer_reference = 'OFF-B'`)
    );

    const rows = await db.asOrganization(ORG_A, (tx) =>
      tx.query('SELECT ci.* FROM cost_items ci WHERE ci.offer_id = $1', [offerB[0].id])
    );
    expect(rows).toHaveLength(0);

    // Jointure volontairement non filtrée sur l'organisation : RLS s'applique.
    const joined = await db.asOrganization(ORG_A, (tx) =>
      tx.query(
        `SELECT ci.label
           FROM cost_items ci
           JOIN supplier_offers so ON so.id = ci.offer_id
          WHERE so.offer_reference = 'OFF-B'`
      )
    );
    expect(joined).toHaveLength(0);
  });

  it('T-ISO-07 : sans contexte d’organisation, TOUT accès est refusé (échec fermé)', async () => {
    const projects = await db.tx((tx) => tx.query('SELECT id FROM projects'));
    expect(projects).toHaveLength(0);

    const offers = await db.tx((tx) => tx.query('SELECT id FROM supplier_offers'));
    expect(offers).toHaveLength(0);

    const logs = await db.tx((tx) => tx.query('SELECT id FROM audit_logs'));
    expect(logs).toHaveLength(0);

    // Une écriture sans contexte est refusée par la policy.
    await expect(
      db.tx((tx) =>
        tx.query(
          `INSERT INTO projects (organization_id, reference, name, category) VALUES ($1, 'REF-X', 'X', 'Test')`,
          [ORG_A]
        )
      )
    ).rejects.toThrow();
  });

  it('T-ISO-08 : le contexte d’organisation ne fuit pas d’une transaction à l’autre', async () => {
    await db.asOrganization(ORG_A, (tx) => tx.query('SELECT 1'));
    // Transaction suivante sans contexte : aucune donnée visible.
    const rows = await db.tx((tx) => tx.query('SELECT id FROM projects'));
    expect(rows).toHaveLength(0);
  });

  it('T-ISO-09 : le journal d’audit est cloisonné et ne peut pas être modifié', async () => {
    await db.asOrganization(ORG_A, async (tx) => {
      await tx.query(
        `INSERT INTO audit_logs (organization_id, actor_name, actor_role, action, entity_type, entry_hash)
         VALUES ($1, 'Test', 'org_admin', 'test.event', 'project', 'aaaa')`,
        [ORG_A]
      );
    });

    const logsA = await db.asOrganization(ORG_A, (tx) => tx.query('SELECT id FROM audit_logs'));
    expect(logsA).toHaveLength(1);

    const logsB = await db.asOrganization(ORG_B, (tx) => tx.query('SELECT id FROM audit_logs'));
    expect(logsB).toHaveLength(0);

    // Append-only : aucune modification ni suppression n'est possible. Deux
    // protections indépendantes s'appliquent (policy RLS sans UPDATE/DELETE, et
    // trigger d'immuabilité). On vérifie le RÉSULTAT : l'entrée est intacte.
    await expect(
      db.systemTx((tx) => tx.query(`UPDATE audit_logs SET action = 'falsifié'`))
    ).rejects.toThrow();

    await expect(db.systemTx((tx) => tx.query('DELETE FROM audit_logs'))).rejects.toThrow();

    const intact = await db.asOrganization(ORG_A, (tx) =>
      tx.query<{ action: string }>('SELECT action FROM audit_logs')
    );
    expect(intact.map((l: any) => l.action)).toEqual(['test.event']);

    // Le trigger d'immuabilité bloque également une écriture tentée avec les
    // privilèges du propriétaire (cas d'un script d'exploitation) : on désactive
    // temporairement le FORCE RLS *dans une transaction dédiée*, puis on vérifie
    // que la protection restante (trigger) refuse la modification.
    await db.systemTx((tx) => tx.query('ALTER TABLE audit_logs NO FORCE ROW LEVEL SECURITY'));
    try {
      const triggerError = await db
        .systemTx((tx) => tx.query(`UPDATE audit_logs SET action = 'falsifié'`))
        .then(() => null)
        .catch((err) => (err as Error).message);
      expect(triggerError).toMatch(/append-only/i);
    } finally {
      await db.systemTx((tx) => tx.query('ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY'));
    }

    const state = await db.systemTx((tx) =>
      tx.query<{ force_rls: boolean }>(
        `SELECT relforcerowsecurity AS force_rls FROM pg_class WHERE relname = 'audit_logs'`
      )
    );
    expect(state[0].force_rls).toBe(true);
  });

  it('T-ISO-10 : chaque organisation ne voit que ses propres utilisateurs', async () => {
    await db.systemTx(async (tx) => {
      await tx.query(
        `INSERT INTO users (organization_id, email, full_name, role, status)
         VALUES ($1, 'admin-a@a.example.com', 'Admin A', 'org_admin', 'active'),
                ($2, 'admin-b@b.example.com', 'Admin B', 'org_admin', 'active')`,
        [ORG_A, ORG_B]
      );
    });

    const usersA = await db.asOrganization(ORG_A, (tx) => tx.query('SELECT email FROM users'));
    expect(usersA.map((u: any) => u.email)).toEqual(['admin-a@a.example.com']);
  });

  it('T-ISO-11 : la résolution de session ne retourne que la session présentée', async () => {
    const tokenHashA = 'a'.repeat(64);
    const { userId } = await db.systemTx(async (tx) => {
      const users = await tx.query<{ id: string }>(`SELECT id FROM users WHERE email = 'admin-a@a.example.com'`);
      await tx.query(
        `INSERT INTO user_sessions (organization_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
        [ORG_A, users[0].id, tokenHashA]
      );
      return { userId: users[0].id };
    });

    const resolved = await db.tx((tx) =>
      tx.query('SELECT * FROM truetco_resolve_session($1)', [tokenHashA])
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].organization_id).toBe(ORG_A);
    expect(resolved[0].user_id).toBe(userId);
    expect(resolved[0].organization_slug).toBe('org-a');

    // Un hachage inconnu ne résout rien.
    const unknown = await db.tx((tx) => tx.query('SELECT * FROM truetco_resolve_session($1)', ['b'.repeat(64)]));
    expect(unknown).toHaveLength(0);
  });

  it('T-ISO-12 : une session expirée ou révoquée ne résout plus', async () => {
    const expiredHash = 'c'.repeat(64);
    const revokedHash = 'd'.repeat(64);
    await db.systemTx(async (tx) => {
      const users = await tx.query<{ id: string }>(`SELECT id FROM users WHERE email = 'admin-b@b.example.com'`);
      await tx.query(
        `INSERT INTO user_sessions (organization_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP - INTERVAL '1 minute'),
                ($1, $2, $4, CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
        [ORG_B, users[0].id, expiredHash, revokedHash]
      );
      await tx.query(`UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1`, [revokedHash]);
    });

    expect(await db.tx((tx) => tx.query('SELECT 1 FROM truetco_resolve_session($1)', [expiredHash]))).toHaveLength(0);
    expect(await db.tx((tx) => tx.query('SELECT 1 FROM truetco_resolve_session($1)', [revokedHash]))).toHaveLength(0);
  });

  it('T-ISO-13 : la création d’organisation est atomique et refuse un domaine déjà pris', async () => {
    const rows = await db.tx((tx) =>
      tx.query<{ organization_id: string; user_id: string }>(
        'SELECT * FROM truetco_register_organization($1, $2, $3, $4, $5)',
        ['Nouvelle Org', 'nouvelle-org', 'nouveau.example.com', 'admin@nouveau.example.com', 'Admin Nouveau']
      )
    );
    expect(rows).toHaveLength(1);

    // Lecture « système » : la table users est soumise au RLS, il faut donc un
    // contexte pour la lire (ici une vérification d'infrastructure).
    const created = await db.systemTx((tx) =>
      tx.query<{ role: string; status: string; organization_id: string }>(
        'SELECT role, status, organization_id FROM users WHERE id = $1',
        [rows[0].user_id]
      )
    );
    expect(created[0].role).toBe('org_admin');
    expect(created[0].status).toBe('active');
    expect(created[0].organization_id).toBe(rows[0].organization_id);

    await expect(
      db.tx((tx) =>
        tx.query('SELECT * FROM truetco_register_organization($1, $2, $3, $4, $5)', [
          'Autre Org',
          'autre-org',
          'nouveau.example.com',
          'admin@autre.example.com',
          'Admin Autre',
        ])
      )
    ).rejects.toThrow(/déjà rattaché/i);
  });

  it('T-ISO-14 : les facteurs ESG de plateforme sont lisibles, ceux d’une autre organisation non', async () => {
    await db.systemTx(async (tx) => {
      await tx.query(
        `INSERT INTO esg_factors (organization_id, code, name, category, unit, value, source_publisher)
         VALUES (NULL, 'PLATFORM-FACTOR', 'Facteur de plateforme', 'carbon', 'kgCO2e/kWh', 0.052, 'Source à documenter'),
                ($1, 'ORG-A-FACTOR', 'Facteur de A', 'carbon', 'kgCO2e/kWh', 0.1, 'Source à documenter')`,
        [ORG_A]
      );
    });

    const visibleForB = await db.asOrganization(ORG_B, (tx) =>
      tx.query<{ code: string }>('SELECT code FROM esg_factors ORDER BY code')
    );
    expect(visibleForB.map((f: any) => f.code)).toEqual(['PLATFORM-FACTOR']);
  });

  it('T-ISO-15 : un facteur ESG ne peut pas être marqué « vérifié » sans vérificateur ni source', async () => {
    await expect(
      db.asOrganization(ORG_A, (tx) =>
        tx.query(
          `INSERT INTO esg_factors (organization_id, code, name, category, unit, value, source_publisher, verification_status)
           VALUES ($1, 'FAUX-VERIFIE', 'Faux', 'carbon', 'kgCO2e/kWh', 1, 'Aucune', 'verified')`,
          [ORG_A]
        )
      )
    ).rejects.toThrow(/ck_esg_factor_verified_complete|vérifi/i);
  });
});
