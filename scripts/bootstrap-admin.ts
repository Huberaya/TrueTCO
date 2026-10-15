/**
 * Amorce (ou ré-active) un administrateur d'organisation SANS identité liée.
 * Il devient réellement actif à sa première connexion Clerk avec cet email VÉRIFIÉ.
 *   npm run admin:bootstrap -- --org <slug|uuid> --email admin@societe.com --name "Prénom Nom" [--create-org "Raison sociale"]
 * Exige le rôle propriétaire (MIGRATION_DATABASE_URL) : jamais exposé via l'API.
 */
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const org = arg('org'); const email = arg('email')?.trim().toLowerCase(); const name = arg('name'); const createOrg = arg('create-org');
  if (!url || !org || !email || !name) throw new Error('Usage : --org <slug|uuid> --email <email> --name "<Nom>" [--create-org "<Raison sociale>"]');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email invalide');

  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(org);
    let row = (await c.query(`SELECT id, name FROM organizations WHERE ${isUuid ? 'id' : 'slug'} = $1`, [org])).rows[0];
    if (!row) {
      if (!createOrg) throw new Error(`Organisation "${org}" introuvable (utiliser --create-org pour la créer)`);
      const id = crypto.randomUUID();
      row = (await c.query(`INSERT INTO organizations (id, name, slug) VALUES ($1,$2,$3) RETURNING id, name`, [id, createOrg, org])).rows[0];
    }
    await c.query(
      `INSERT INTO users (organization_id, email, full_name, role, is_active, clerk_id, quarantined_at)
       VALUES ($1,$2,$3,'admin',TRUE,NULL,NULL)
       ON CONFLICT (organization_id, email) DO UPDATE
         SET role = 'admin', is_active = TRUE, clerk_id = NULL, quarantined_at = NULL, full_name = EXCLUDED.full_name`,
      [row.id, email, name]
    );
    await c.query('COMMIT');
    console.log(`✓ ${email} est administrateur en attente de "${row.name}". Il doit se connecter avec cet email vérifié.`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
