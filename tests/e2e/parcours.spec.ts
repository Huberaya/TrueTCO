/**
 * TrueTCO — Parcours de bout en bout (navigateur réel)
 * ---------------------------------------------------------------------------
 * Ces tests suivent le « test de réalité » exigé par le cahier des charges :
 * une PME, trois offres, une recommandation, un import, une reconnexion — et
 * l'exigence que TOUT persiste côté serveur (pas dans le navigateur).
 *
 * Ils ne remplacent pas les tests d'API : ils vérifient ce que voit un
 * utilisateur, dans un navigateur, avec le serveur réel.
 *
 * IMPORTANT — exécution : voir playwright.config.ts. Dans l'environnement de
 * développement initial, le téléchargement du navigateur était bloqué par le
 * filtrage réseau ; la suite est donc exécutée en intégration continue (voir
 * .github/workflows/ci.yml, tâche « Parcours navigateur ») et sur toute machine
 * disposant d'un navigateur.
 */

import { expect, test } from '@playwright/test';
import path from 'path';

const UNIQUE = Date.now();
const ORG_NAME = `PME Test ${UNIQUE}`;
const ADMIN_EMAIL = `patron.${UNIQUE}@pme-test.example`;
const ADMIN_PASSWORD = `Motdepasse!${UNIQUE}`;

/** Fichier d'import écrit pour le test : il contient une catégorie inconnue. */
const CSV_SAMPLE = [
  'Fournisseur;Référence;Désignation;Catégorie;Montant;Source',
  'Alpha Équipements;OFF-A;Achat véhicules;acquisition;200000;Devis signé 2026',
  'Alpha Équipements;OFF-A;Énergie annuelle;energie;45000;Relevés télématiques 2025',
  'Beta Location;OFF-B;Location véhicules;acquisition;350000;Contrat cadre',
  'Beta Location;OFF-B;Énergie annuelle;energie;10000;Relevés télématiques 2025',
  'Gamma Services;OFF-C;Frais de gestion divers;opex;12000;Facture',
].join('\n');

test.describe('Parcours PME complet', () => {
  test('T-E2E-01 : inscription, trois offres importées, décision, reconnexion — tout persiste', async ({ page }) => {
    // 1. Ouverture de l'application : aucun compte de démonstration n'est ouvert
    //    automatiquement (exigence de sécurité) — l'écran de connexion doit être là.
    await page.goto('/');
    await expect(page.getByText(/TrueTCO/i).first()).toBeVisible();

    // 2. Inscription d'une organisation (première utilisatrice : propriétaire).
    await page.getByRole('button', { name: /connexion|se connecter|créer/i }).first().click();
    await page.getByLabel(/organisation|société/i).first().fill(ORG_NAME);
    await page.getByLabel(/e-?mail/i).first().fill(ADMIN_EMAIL);
    await page.getByLabel(/mot de passe/i).first().fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /créer|inscrire|valider/i }).first().click();

    await expect(page.getByText(/connecté|déconnexion|tableau de bord/i).first()).toBeVisible({ timeout: 30_000 });

    // 3. Création d'un dossier.
    await page.getByRole('button', { name: /nouveau dossier/i }).first().click();
    await page.getByLabel(/référence/i).first().fill(`E2E-${UNIQUE}`);
    await page.getByLabel(/nom|intitulé/i).first().fill('Flotte de 40 véhicules');
    await page.getByRole('button', { name: /créer|valider|enregistrer/i }).first().click();

    // 4. Import d'un fichier de trois offres (dont une catégorie inconnue).
    await page.getByRole('button', { name: /centre d'import/i }).first().click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByText(/fichier \(.xlsx ou .csv\)/i).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'offres-pme.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV_SAMPLE, 'utf-8'),
    });
    await page.getByRole('button', { name: /analyser le fichier/i }).click();

    // 5. L'aperçu signale la catégorie inconnue et refuse d'importer sans arbitrage.
    await expect(page.getByText(/Import bloqué/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/« opex »/i)).toBeVisible();

    // 6. L'utilisateur arbitre explicitement la catégorie, puis importe.
    await page.getByRole('combobox').filter({ hasText: /choisir/i }).first().selectOption('couts_administratifs_conformite');
    await expect(page.getByRole('button', { name: /^Importer /i })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Importer /i }).click();
    await expect(page.getByText(/Import terminé et journalisé/i)).toBeVisible({ timeout: 30_000 });

    // 7. Calcul de la décision : classement, VAN, recommandation ou refus explicite.
    await page.getByRole('button', { name: /décision d'arbitrage/i }).first().click();
    await page.getByRole('button', { name: /calculer la décision/i }).click();
    await expect(page.getByText(/Classement sur la VAN du coût complet/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/OFF-A/).first()).toBeVisible();
    await expect(page.getByText(/Pourquoi ce montant/i).first()).toBeVisible();

    // 8. Le journal d'audit porte la trace de l'import, avec le chaînage vérifié
    //    par le serveur (et non par le navigateur).
    await page.getByRole('button', { name: /journal d'audit/i }).first().click();
    await expect(page.getByText(/import\.committed|import\.uploaded/i).first()).toBeVisible({ timeout: 30_000 });

    // 9. Reconnexion dans un NOUVEAU contexte de navigation : les données doivent
    //    venir du serveur. Aucune donnée ne doit subsister dans le navigateur.
    const context = await page.context().browser()!.newContext();
    const freshPage = await context.newPage();
    await freshPage.goto('/');
    await freshPage.getByRole('button', { name: /connexion|se connecter/i }).first().click();
    await freshPage.getByLabel(/e-?mail/i).first().fill(ADMIN_EMAIL);
    await freshPage.getByLabel(/mot de passe/i).first().fill(ADMIN_PASSWORD);
    await freshPage.getByRole('button', { name: /se connecter|valider/i }).first().click();

    await expect(freshPage.getByText(`E2E-${UNIQUE}`).first()).toBeVisible({ timeout: 30_000 });
    await freshPage.getByRole('button', { name: /décision d'arbitrage/i }).first().click();
    await expect(freshPage.getByText(/OFF-A/).first()).toBeVisible({ timeout: 30_000 });
    await context.close();
  });

  test('T-E2E-02 : une donnée manquante est signalée et jamais inventée', async ({ page }) => {
    const csv = [
      'Fournisseur;Référence;Désignation;Catégorie;Montant;Source',
      'Delta;OFF-D;Poste sans montant;maintenance;N/A;Devis',
    ].join('\n');

    await page.goto('/');
    await page.getByRole('button', { name: /connexion|se connecter/i }).first().click();
    await page.getByLabel(/e-?mail/i).first().fill(ADMIN_EMAIL);
    await page.getByLabel(/mot de passe/i).first().fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /se connecter|valider/i }).first().click();

    await page.getByRole('button', { name: /centre d'import/i }).first().click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByText(/fichier \(.xlsx ou .csv\)/i).click();
    (await chooser).setFiles({ name: 'manquant.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
    await page.getByRole('button', { name: /analyser le fichier/i }).click();

    await expect(page.getByText(/MISSING/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/MISSING_VALUES|sans valeur obligatoire/i).first()).toBeVisible();
    // Le total affiché est nul, et l'import reste bloqué.
    await expect(page.getByText(/Import bloqué/i)).toBeVisible();
  });
});
