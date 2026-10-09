/**
 * Les outils de sauvegarde du navigateur ne doivent jamais se faire passer pour
 * une sauvegarde, une restauration ou une migration de la base serveur.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DataBackupModal } from '../src/components/DataBackupModal';

const emptyData = {
  projects: [],
  offers: [],
  suppliers: [],
  benchmarks: [],
  auditLogs: [],
};

const renderModal = (isLocalDemo: boolean) =>
  render(
    <DataBackupModal
      isOpen
      onClose={() => undefined}
      {...emptyData}
      isLocalDemo={isLocalDemo}
      onRestoreData={() => undefined}
      onResetSeed={() => undefined}
    />
  );

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          database: { connected: true, driver: 'pglite', version: 'PostgreSQL 18', appRoleAssumed: true },
          versions: { engine: '2.1.0', methodology: '2026.2' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Sauvegarde locale et migrations', () => {
  it('refuse export, restauration et réinitialisation du cache lorsque les données sont serveur', () => {
    renderModal(false);

    expect(screen.getByRole('alert').textContent).toMatch(/Sauvegarde locale désactivée/i);
    expect(screen.queryByRole('button', { name: 'Exporter (.json)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Importer (.json)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Réinitialiser' })).toBeNull();
  });

  it('montre la commande de migration versionnée, sans générateur de dump depuis le navigateur', () => {
    renderModal(false);
    fireEvent.click(screen.getByRole('button', { name: 'Migrations de schéma' }));

    expect(screen.getByText('npm run db:migrate')).toBeTruthy();
    expect(screen.getByText(/n’exporte, ne sauvegarde et ne restaure aucune donnée métier/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Générer .sql/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tester la validité/i })).toBeNull();
  });

  it('conserve les outils JSON uniquement dans le mode local explicitement signalé comme démonstration', () => {
    renderModal(true);

    expect(screen.getByRole('button', { name: 'Exporter (.json)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Importer (.json)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réinitialiser' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
