import { Client } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is missing in environment!');
    process.exit(1);
  }

  console.log('Connecting to Neon via WebSocket client (multi-statement support)...');
  const client = new Client(dbUrl);
  await client.connect();

  const nowRes = await client.query('SELECT NOW(), current_database(), current_user;');
  console.log('✓ Successfully connected to Neon:', nowRes.rows[0]);

  // Read schema.sql
  const schemaPath = path.resolve(__dirname, '../src/db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  console.log('Applying relational schema (10 tables, triggers, indexes)...');
  await client.query(schemaSql);
  console.log('✓ Schema applied successfully to Neon!');

  // Verify created tables
  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('✓ Verified tables in Neon public schema:', tablesRes.rows.map(r => r.table_name));

  // Seed default data if organizations table is empty
  const orgCountRes = await client.query('SELECT COUNT(*) as count FROM organizations;');
  if (parseInt(orgCountRes.rows[0].count, 10) === 0) {
    console.log('Seeding initial data to Neon...');
    const seedPath = path.resolve(__dirname, '../src/db/seed.sql');
    if (fs.existsSync(seedPath)) {
      const seedSql = fs.readFileSync(seedPath, 'utf8');
      await client.query(seedSql);
      console.log('✓ Seed data populated successfully!');
    }
  } else {
    console.log(`✓ Neon database already contains data (${orgCountRes.rows[0].count} organization(s)).`);
  }

  await client.end();
  console.log('✓ Migration finished cleanly.');
}

runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
