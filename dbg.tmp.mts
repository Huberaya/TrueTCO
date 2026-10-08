import { createTestDb } from './server/db/testing';
import { hashToken, sessionExpiry } from './server/auth/session';
import request from 'supertest';
import { createApp } from './server/app';
const ORG='11111111-1111-4111-8111-111111111111';
const db = await createTestDb({ quiet: true });
await db.systemTx(async (tx) => {
  await tx.query(`INSERT INTO organizations (id,name,slug,domain) VALUES ($1,'O','o','o.example.com')`,[ORG]);
  const u = await tx.query(`INSERT INTO users (organization_id,email,full_name,role,status) VALUES ($1,'a@o.example.com','A','org_admin','active') RETURNING id`,[ORG]);
  await tx.query(`INSERT INTO user_sessions (organization_id,user_id,token_hash,auth_method,expires_at) VALUES ($1,$2,$3,'test',$4)`,[ORG,u[0].id,hashToken('tok-'+'x'.repeat(20)),sessionExpiry().toISOString()]);
});
// 1) appeler la fonction de vérification directement
try {
  await db.asOrganization(ORG, (tx)=>tx.query('SELECT * FROM truetco_verify_audit_chain($1)',[ORG]));
  console.log('verify sans entrée : OK');
} catch(e:any){ console.log('verify ERREUR:', e.code, e.message); }
// 2) insérer une entrée d'audit réelle via l'API puis revérifier
const app = createApp({db,isProd:false,allowDemoAuth:false,allowedOrigins:[],engineVersion:'2.0.0',methodologyVersion:'2026.1'});
const auth = { Authorization: 'Bearer tok-'+'x'.repeat(20) };
const p = await request(app).post('/api/projects').set(auth).send({reference:'R1',name:'Dossier',category:'Flotte'});
console.log('create project:', p.status, JSON.stringify(p.body).slice(0,160));
const v = await request(app).get('/api/audit-logs/integrity').set(auth);
console.log('integrity:', v.status, JSON.stringify(v.body).slice(0,300));
// 3) transition interdite
const s = await request(app).post(`/api/projects/${p.body.id}/status`).set(auth).send({status:'locked',justification:'Tentative de saut direct vers verrouillé.'});
console.log('transition:', s.status, JSON.stringify(s.body).slice(0,300));
await db.close();
