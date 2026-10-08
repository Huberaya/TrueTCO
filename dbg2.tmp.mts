import { createTestDb } from './server/db/testing';
const ORG='11111111-1111-4111-8111-111111111111';
const db = await createTestDb({ quiet: true });
await db.systemTx(async (tx) => {
  await tx.query(`INSERT INTO organizations (id,name,slug,domain) VALUES ($1,'O','o','o.example.com')`,[ORG]);
  await tx.query(`INSERT INTO audit_logs (organization_id, occurred_at, actor_name, actor_role, action, entity_type, entry_hash, payload_canonical)
                  VALUES ($1, CURRENT_TIMESTAMP, 'A', 'org_admin', 'test', 'x', 'abc', '["payload accentué é"]')`,[ORG]);
});
try {
  const r = await db.asOrganization(ORG, (tx)=>tx.query('SELECT * FROM truetco_verify_audit_chain($1)',[ORG]));
  console.log('OK', JSON.stringify(r));
} catch(e:any){ console.log('ERREUR:', e.code, '|', e.message); }
console.log('sha256 dispo ?', JSON.stringify(await db.systemTx((tx)=>tx.query("SELECT proname FROM pg_proc WHERE proname IN ('sha256','digest','encode')"))));
await db.close();
