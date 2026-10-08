import { createTestDb } from './server/db/testing';
import request from 'supertest';
import { createApp } from './server/app';
const ORG='11111111-1111-4111-8111-111111111111';
const db = await createTestDb({ quiet: true });
const { hashToken, sessionExpiry } = await import('./server/auth/session');
await db.systemTx(async (tx) => {
  await tx.query(`INSERT INTO organizations (id,name,slug,domain) VALUES ($1,'O','o','o.example.com')`,[ORG]);
  const u = await tx.query(`INSERT INTO users (organization_id,email,full_name,role,status) VALUES ($1,'a@o.example.com','A','org_admin','active') RETURNING id`,[ORG]);
  await tx.query(`INSERT INTO user_sessions (organization_id,user_id,token_hash,auth_method,expires_at) VALUES ($1,$2,$3,'test',$4)`,[ORG,u[0].id,hashToken('tok-'+'x'.repeat(20)),sessionExpiry().toISOString()]);
});
const app = createApp({db,isProd:false,allowDemoAuth:false,allowedOrigins:[],engineVersion:'2.0.0',methodologyVersion:'2026.1'});
await request(app).post('/api/projects').set({Authorization:'Bearer tok-'+'x'.repeat(20)}).send({reference:'R1',name:'Dossier',category:'Flotte'});
const rows = await db.systemTx((tx)=>tx.query<{payload_canonical:string; entry_hash:string}>('SELECT payload_canonical, entry_hash FROM audit_logs'));
console.log('payload:', JSON.stringify(rows[0].payload_canonical));
try {
  const r = await db.systemTx((tx)=>tx.query(`SELECT entry_hash <> encode(sha256(payload_canonical::bytea),'hex') AS mismatch FROM audit_logs`));
  console.log('comparaison:', JSON.stringify(r));
} catch(e:any){ console.log('comparaison ERREUR:', e.message); }
try {
  const r = await db.systemTx((tx)=>tx.query('SELECT * FROM truetco_verify_audit_chain($1)',[ORG]));
  console.log('verify:', JSON.stringify(r));
} catch(e:any){ console.log('verify ERREUR:', e.message); }
await db.close();
