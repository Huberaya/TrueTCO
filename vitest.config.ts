import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx', 'tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    // Les tests de bout en bout appartiennent à Playwright : ils pilotent un
    // navigateur et ne doivent pas être exécutés (ni comptés) par Vitest.
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    // Les tests d'interface ont besoin d'un DOM ; les autres tournent en Node.
    environmentMatchGlobs: [['**/*.spec.tsx', 'jsdom']],
    environment: 'node',
    // PGlite (PostgreSQL embarqué) démarre une instance WASM par fichier de test :
    // les tests de base de données demandent plus de temps que les tests de calcul.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    reporters: ['default'],
  },
});
