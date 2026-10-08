import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    environment: 'node',
    // PGlite (PostgreSQL embarqué) démarre une instance WASM par fichier de test :
    // les tests de base de données demandent plus de temps que les tests de calcul.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    reporters: ['default'],
  },
});
