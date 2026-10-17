import { describe, expect, it } from 'vitest';
import { runAllTCOEngineTests } from '../src/engine/tcoEngine.test';

/**
 * Les tests historiques du moteur (auparavant déclenchés par un bouton de l'interface) s'exécutent désormais en CI.
 * Leurs assertions sont larges (fourchettes) : le chantier 4 les remplace par des valeurs exactes recalculées indépendamment.
 */
describe('Moteur TCO — tests historiques', () => {
  const run = runAllTCOEngineTests();
  it('la suite s\'exécute', () => expect(run.total).toBeGreaterThan(0));
  it.each(run.results.map((r) => [r.category + ' — ' + r.name, r] as const))('%s', (_n, r) => {
    expect(r.passed, `attendu: ${r.expected} / obtenu: ${r.actual}`).toBe(true);
  });
});
