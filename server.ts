import express from 'express';
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClerkSessionMiddleware } from './src/server/clerkAuth';
import { createFailClosedApiGate } from './src/server/apiGate';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// This Clerk layer only verifies a session when configured; it grants no access.
app.use('/api', createClerkSessionMiddleware());
// Keep before every API route and static/Vite fallback: only GET /health passes.
app.use('/api', createFailClosedApiGate());

// Public liveness only. Do not expose DB connectivity, identity or configuration.
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Historical business/auth handlers have been removed. The API gate also rejects
// unknown paths and methods, so no fallback can expose a business response.
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const server = http.createServer(app);

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`TrueTCO server listening on ${PORT}; only GET /api/health is enabled.`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
