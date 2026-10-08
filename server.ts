/**
 * TrueTCO — Amorçage du serveur (Express + Vite en développement)
 * ---------------------------------------------------------------------------
 * Ce fichier ne contient plus aucune logique métier :
 *   - `server/security.ts` : en-têtes, limitation de débit, erreurs corrélées
 *   - `server/auth.ts`     : sessions, rôles, permissions, isolation tenant
 *   - `server/routes.ts`   : endpoints API
 *
 * CONFIGURATION (voir .env.example) :
 *   DATABASE_URL                    chaîne PostgreSQL (Neon)
 *   TRUETCO_ALLOW_DEMO_AUTH         « true » pour autoriser les sessions de
 *                                   démonstration HORS production uniquement
 *   TRUETCO_ENABLE_SYNTHETIC_CONNECTORS  « true » pour activer les connecteurs
 *                                   ERP simulés (démonstration)
 *   TRUETCO_ALLOWED_ORIGINS         liste d'origines CORS autorisées
 */

import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { neon } from '@neondatabase/serverless';
import { createApiRouter } from './server/routes';
import { correlationId, errorHandler, rateLimit, securityHeaders } from './server/security';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

const DATABASE_URL = process.env.DATABASE_URL;
const allowDemoAuth = process.env.TRUETCO_ALLOW_DEMO_AUTH === 'true' && !isProd;
const enableSyntheticConnectors = process.env.TRUETCO_ENABLE_SYNTHETIC_CONNECTORS === 'true';

if (isProd && !DATABASE_URL) {
  console.error('[TrueTCO] FATAL : DATABASE_URL est obligatoire en production.');
  process.exit(1);
}
if (isProd && process.env.TRUETCO_ALLOW_DEMO_AUTH === 'true') {
  console.error(
    '[TrueTCO] FATAL : TRUETCO_ALLOW_DEMO_AUTH est interdit en production (aucune authentification réelle ne serait appliquée).'
  );
  process.exit(1);
}

const sql = DATABASE_URL ? neon(DATABASE_URL) : null;
if (!sql) {
  console.warn('[TrueTCO] DATABASE_URL absente : les endpoints de données renverront 503.');
}

const app = express();
app.disable('x-powered-by');
// Derrière un proxy (Vercel, Cloud Run, reverse proxy interne) : nécessaire
// pour que req.ip et la limitation de débit reflètent le client réel.
app.set('trust proxy', 1);

app.use(correlationId);
app.use(securityHeaders(isProd));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

// --- Politique CORS explicite ------------------------------------------------
const allowedOrigins = (process.env.TRUETCO_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const sameOrigin = origin === `${req.protocol}://${req.headers.host}`;
    if (sameOrigin || allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    } else if (req.method !== 'OPTIONS') {
      return res.status(403).json({ error: 'Origine non autorisée.', code: 'CORS_ORIGIN_DENIED' });
    }
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

// Limite globale anti-abus.
app.use('/api', rateLimit({ windowMs: 60_000, max: 600, name: 'global' }));

// --- API --------------------------------------------------------------------
app.use(
  '/api',
  createApiRouter({
    sql,
    isProd,
    allowDemoAuth,
    enableSyntheticConnectors,
    geminiApiKey: process.env.GEMINI_API_KEY,
  })
);

// --- Frontend (Vite en dev, fichiers statiques en production) ----------------
async function startServer() {
  const server = http.createServer(app);

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
        // L'aperçu est servi sur un domaine proxy : les hosts arbitraires sont
        // autorisés UNIQUEMENT en développement.
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
          if (/\.(js|css|woff2?|png|svg)$/.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.use(errorHandler(isProd));

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`✓ TrueTCO — serveur actif sur le port ${PORT}`);
    console.log(`✓ Base de données : ${sql ? 'connectée' : 'NON CONFIGURÉE'}`);
    console.log(`✓ Mode : ${isProd ? 'production' : 'développement'}`);
    console.log(`✓ Authentification de démonstration : ${allowDemoAuth ? 'ACTIVÉE (hors production)' : 'désactivée'}`);
    console.log(`✓ Connecteurs ERP simulés : ${enableSyntheticConnectors ? 'activés (données synthétiques)' : 'désactivés'}`);
    console.log(`✓ Origines CORS autorisées : ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : 'même origine uniquement'}`);
  });
}

startServer().catch((err) => {
  console.error('Échec du démarrage du serveur :', err);
  process.exit(1);
});
