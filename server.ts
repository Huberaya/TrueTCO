import dotenv from 'dotenv';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app';
import { GeminiExtractor } from './server/ai';
import { ClerkVerifier } from './server/auth';
import { loadConfig } from './server/config';
import { PgDb, checkRlsEnforced } from './server/db';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const config = loadConfig();

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL est requis : le serveur ne démarre pas sans base de données.');
  }
  if (!config.clerkSecretKey && !config.clerkJwtKey) {
    throw new Error("CLERK_SECRET_KEY (ou CLERK_JWT_KEY) est requis : il n'existe pas de mode sans authentification.");
  }

  const db = new PgDb(config.databaseUrl);
  const rls = await checkRlsEnforced(db);
  if (!rls.enforced) {
    const msg = `La connexion base de données utilise le rôle "${rls.role}" qui CONTOURNE le Row Level Security. Utilisez le rôle truetco_app (voir docs/SECURITY.md).`;
    if (config.isProd && config.requireRls) throw new Error(msg);
    console.warn(`⚠️  ${msg} L'isolation repose alors uniquement sur la couche applicative.`);
  }

  const app = createApp({
    db,
    verifier: new ClerkVerifier(config),
    config,
    ai: config.geminiApiKey ? new GeminiExtractor(config.geminiApiKey, config.geminiModel) : undefined,
  });
  const server = http.createServer(app);

  if (!config.isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR === 'true' ? false : { server } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => res.sendFile(path.resolve(__dirname, 'dist', 'index.html')));
  }

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`✓ TrueTCO server on port ${config.port} (RLS ${rls.enforced ? 'enforced' : 'NOT enforced'})`);
  });

  const shutdown = () => server.close(() => db.close().finally(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
