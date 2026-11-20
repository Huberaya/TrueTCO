import express from 'express';
import http from 'node:http';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './src/server/application';
import { createRuntimeTenantIdentityMiddleware } from './src/server/runtimeTenantIdentity';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const app = createApplication({
    tenantIdentityMiddleware: createRuntimeTenantIdentityMiddleware(),
  });
  const server = http.createServer(app);

  if (!isProd) {
    // Vite is a build/development tool, not a production runtime dependency.
    const { createServer: createViteServer } = await import('vite');
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
