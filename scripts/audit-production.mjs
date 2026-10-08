#!/usr/bin/env node
/**
 * TrueTCO — Audit des dépendances de PRODUCTION
 * ---------------------------------------------------------------------------
 * Échoue si une dépendance embarquée porte un avis de sécurité de gravité
 * « high » ou « critical ».
 *
 * Pourquoi c'est bloquant : un avis sans correctif connu a déjà été trouvé dans
 * ce projet (paquet `xlsx`, prototype pollution et ReDoS). Il ne doit pas être
 * possible d'ajouter une telle dépendance sans que la chaîne d'intégration le
 * signale.
 *
 * Les avis « moderate » de dépendances de développement (outils de test) sont
 * listés mais ne bloquent pas : ils ne sont pas livrés aux utilisateurs. Toute
 * exception doit être écrite ici, avec sa raison.
 */
import { execFileSync } from 'child_process';

/** Avis connus et ASSUMÉS, avec la raison précise. */
const ACCEPTED = [
  {
    package: 'xlsx',
    reason:
      "Utilisé uniquement pour l'EXPORT côté client (génération d'un classeur à partir de données déjà en mémoire). " +
      "Aucun fichier d'utilisateur n'est analysé par cette bibliothèque : la lecture des imports passe par ExcelJS. " +
      'À remplacer lors de la migration de l’export (voir AUDIT-TRUETCO-2026.md).',
  },
];

let report;
try {
  report = JSON.parse(execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' }));
} catch (error) {
  // `npm audit` sort en erreur dès qu'un avis existe : la sortie reste exploitable.
  const stdout = error.stdout ?? '';
  if (!stdout) {
    console.error("L'audit des dépendances n'a pas pu être exécuté :", error.message);
    process.exit(1);
  }
  report = JSON.parse(stdout);
}

const vulnerabilities = report.vulnerabilities ?? {};
const blocking = [];
const accepted = [];

for (const [name, info] of Object.entries(vulnerabilities)) {
  if (info.severity !== 'high' && info.severity !== 'critical') continue;
  const exception = ACCEPTED.find((entry) => entry.package === name);
  if (exception) accepted.push({ name, severity: info.severity, reason: exception.reason });
  else blocking.push({ name, severity: info.severity, via: (info.via ?? []).map((v) => (typeof v === 'string' ? v : v.title)) });
}

if (accepted.length > 0) {
  console.log('Avis de gravité haute/critique assumés explicitement :');
  for (const entry of accepted) console.log(`  - ${entry.name} (${entry.severity}) : ${entry.reason}`);
}

if (blocking.length > 0) {
  console.error('ÉCHEC : dépendances de production avec un avis de gravité haute ou critique non assumé :');
  for (const entry of blocking) {
    console.error(`  - ${entry.name} (${entry.severity}) : ${entry.via.join(' ; ') || 'voir npm audit'}`);
  }
  console.error(
    "Traitez l'avis (montée de version, remplacement de la dépendance) ou documentez une exception motivée dans scripts/audit-production.mjs."
  );
  process.exit(1);
}

console.log('Aucune dépendance de production bloquante.');
