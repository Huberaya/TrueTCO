/**
 * TrueTCO — Configuration des tests navigateur (Playwright)
 * ---------------------------------------------------------------------------
 * Les tests exécutent l'application avec l'API Express, PostgreSQL embarqué
 * (PGlite) et le front servi par Vite en mode développement. Les requêtes API ne
 * sont pas simulées ; ce test n'exécute toutefois pas le serveur statique du
 * build de production.
 *
 * Par défaut, Playwright démarre et attend l'API (PGlite) et Vite via webServer.
 * Pour utiliser une stack externe : TRUETCO_E2E_START_SERVERS=false et définir
 * TRUETCO_E2E_BASE_URL / TRUETCO_E2E_API_URL.
 *
 * Prérequis :
 *   npx playwright install chromium
 *   npm run test:e2e
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.TRUETCO_E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const API_URL = process.env.TRUETCO_E2E_API_URL ?? 'http://127.0.0.1:3000';
const startLocalServers = process.env.TRUETCO_E2E_START_SERVERS !== 'false';

export default defineConfig({
  webServer: startLocalServers
    ? [
        {
          command: 'npm run test:e2e:server',
          url: `${API_URL}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            ...process.env,
            PORT: new URL(API_URL).port || '3000',
            TRUETCO_USE_PGLITE: 'true',
            TRUETCO_AUTO_MIGRATE: 'true',
            TRUETCO_ALLOW_DEMO_AUTH: 'true',
          },
        },
        {
          command: 'npm run dev',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            ...process.env,
            VITE_PORT: new URL(BASE_URL).port || '5173',
            TRUETCO_API_URL: API_URL,
          },
        },
      ]
    : undefined,
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
