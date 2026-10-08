/**
 * TrueTCO — Configuration des tests navigateur (Playwright)
 * ---------------------------------------------------------------------------
 * Les tests exécutent l'application RÉELLE : le serveur (API + PostgreSQL
 * embarqué) et le serveur de développement Vite, comme en production. Aucune
 * requête n'est simulée : ce que ces tests vérifient est ce que l'utilisateur
 * obtient.
 *
 * Prérequis :
 *   npm run test:e2e:server &   (API + base)
 *   npx playwright install chromium
 *   npm run test:e2e
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.TRUETCO_E2E_BASE_URL ?? 'http://127.0.0.1:5173';

export default defineConfig({
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
