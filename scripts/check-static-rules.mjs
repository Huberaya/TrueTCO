#!/usr/bin/env node
/**
 * TrueTCO — Contrôles statiques ciblés (remplace ESLint, voir TESTING.md)
 * ---------------------------------------------------------------------------
 * POURQUOI CE SCRIPT EXISTE
 * ESLint ne peut pas être utilisé dans ce projet : son moteur TypeScript
 * (typescript-eslint 8.x, dernier publié) refuse TypeScript 7 et s'arrête au
 * chargement. Plutôt que d'afficher une étape « lint » qui ne vérifierait rien,
 * ce script applique des règles VÉRIFIABLES, chacune liée à un défaut réel déjà
 * rencontré ou interdit par le cahier des charges.
 *
 * Chaque règle indique ce qu'elle empêche :
 *   R1  erreur avalée (catch vide)              → panne silencieuse
 *   R2  console.log/console.warn dans le serveur → trace perdue faute de collecte
 *   R3  tests neutralisés (.only)                → suite verte alors que rien n'est testé
 *   R4  lecture de fichiers utilisateurs par `xlsx` → dépendance vulnérable (avis
 *       hauts sans correctif) sur des entrées non fiables
 *   R5  accès au stockage du navigateur côté serveur → donnée client prise pour
 *       une source de vérité
 *   R6  secrets en clair dans le code            → fuite par dépôt
 *   R7  évaluation dynamique (eval / new Function) → exécution de code arbitraire
 *   R8  dépendance du serveur envers les composants d'interface → couches inversées
 *   R9  certification ou conformité revendiquée dans l'interface → fausse preuve
 *   R10 calcul du TCO/décision dans le navigateur → résultat non persisté/non rejouable
 */
import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'playwright-report', 'test-results', '.github']);

async function collect(dir, extensions) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await collect(full, extensions)));
      continue;
    }
    if (extensions.some((extension) => entry.name.endsWith(extension))) files.push(full);
  }
  return files;
}

const serverFiles = await collect(path.join(ROOT, 'server'), ['.ts']);
const testFiles = await collect(path.join(ROOT, 'tests'), ['.ts', '.tsx']);
const allSource = [...serverFiles, ...(await collect(path.join(ROOT, 'src'), ['.ts', '.tsx']))];

/** Les seules exceptions tolérées, chacune justifiée. */
const ALLOWANCES = [
  {
    rule: 'R2',
    file: 'server/db/migrate.ts',
    reason:
      "Le script de migration doit pouvoir écrire sur la sortie standard avant que la journalisation applicative ne soit disponible.",
  },
];

const violations = [];

function report(rule, file, line, message) {
  const relative = path.relative(ROOT, file).split(path.sep).join('/');
  const allowed = ALLOWANCES.some((entry) => entry.rule === rule && entry.file === relative);
  if (!allowed) violations.push({ rule, file: relative, line, message });
}

/** R1 — aucune erreur avalée. */
for (const file of [...serverFiles, ...allSource]) {
  const content = await fs.readFile(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) {
      report('R1', file, index + 1, 'Bloc « catch » vide : erreur ignorée sans trace.');
    }
  });
}

/** R2 — pas de console.log/console.warn dans le serveur applicatif. */
for (const file of serverFiles) {
  const content = await fs.readFile(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (/console\.(log|warn|error|debug)\s*\(/.test(line)) {
      report('R2', file, index + 1, 'Écriture console dans le serveur : utiliser la journalisation structurée.');
    }
  });
}

/** R3 — aucun test neutralisé. */
for (const file of testFiles) {
  const content = await fs.readFile(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    if (/\b(it|test|describe)\.only\s*\(/.test(line) || /\bdescribe\.skip\s*\(/.test(line)) {
      report('R3', file, index + 1, 'Test neutralisé (.only ou describe.skip) : la suite deviendrait verte sans rien vérifier.');
    }
  });
}

/** R4 — la lecture de fichiers utilisateurs ne passe jamais par `xlsx`. */
for (const file of serverFiles) {
  const content = await fs.readFile(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    if (/from\s+['"]xlsx['"]|require\(\s*['"]xlsx['"]\s*\)/.test(line)) {
      report(
        'R4',
        file,
        index + 1,
        "Le paquet `xlsx` porte des avis de sécurité hauts sans correctif : interdit pour lire des fichiers d'utilisateurs (utiliser ExcelJS)."
      );
    }
  });
}

/** R5 — le stockage du navigateur n'existe pas côté serveur. */
for (const file of serverFiles) {
  const content = await fs.readFile(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    if (/\b(localStorage|sessionStorage|document\.cookie)\b/.test(line)) {
      report('R5', file, index + 1, 'Accès au stockage du navigateur depuis le serveur : couche incorrecte.');
    }
  });
}

/** R6 — aucun secret en clair. */
const SECRET_PATTERNS = [
  /(password|passwd|secret|api[_-]?key|private[_-]?key)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
  /postgres(ql)?:\/\/[^\s'"]*:[^\s'"]*@/i,
];
for (const file of allSource) {
  const content = await fs.readFile(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    // Les valeurs d'exemple explicitement marquées et les tests sont tolérés.
    if (/EXAMPLE|placeholder|TODO|<[a-z-]+>|\$\{/.test(line)) return;
    if (SECRET_PATTERNS.some((pattern) => pattern.test(line))) {
      report('R6', file, index + 1, 'Valeur ressemblant à un secret en clair dans le code.');
    }
  });
}

/** R7 — aucune évaluation dynamique. */
for (const file of allSource) {
  const content = await fs.readFile(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (/\beval\s*\(|new\s+Function\s*\(/.test(line)) {
      report('R7', file, index + 1, "Évaluation dynamique de code : interdite (exécution arbitraire).");
    }
  });
}

/** R8 — le serveur ne dépend pas des composants d'interface. */
for (const file of serverFiles) {
  const content = await fs.readFile(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    if (/from\s+['"][^'"]*src\/components\//.test(line)) {
      report('R8', file, index + 1, "Le serveur importe un composant d'interface : dépendance inversée.");
    }
  });
}

/**
 * R9 — aucune certification ni conformité revendiquée dans l'interface.
 *
 * Le produit affichait « ISO 27001 · SOC 2 Type II », « Certifié ISO 15686-5 »,
 * « Conformité CAC & Article L. 823-10 », « Certifié Quantum », etc. Aucune de ces
 * mentions ne correspondait à un document, un audit ou une habilitation réelle.
 * Une revendication de conformité est une preuve : elle doit exister hors du code
 * avant d'être affichée.
 *
 * La règle est volontairement sensible à la négation : écrire « aucune certification
 * de conformité n'est délivrée » est exact et doit rester possible.
 */
const CLAIM_TOKENS = [
  /\bISO\s?27001\b/i,
  /\bSOC\s?2\b/i,
  /\b823-10\b/,
  /\bCertEurope\b/i,
  /\bANSSI\b/,
  /\bimmuable\b/i,
  /\bNeon\s+PostgreSQL\b/i,
  /\bcertifi[ée]e?s?\b/i,
];
const NEGATION = /\b(pas|aucun|aucune|sans|non|jamais|ne)\b|n['’]/i;

for (const file of allSource) {
  if (!file.split(path.sep).join('/').includes('/src/components/')) continue;
  const content = await fs.readFile(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);
    if (isComment) return;
    if (!CLAIM_TOKENS.some((token) => token.test(line))) return;
    if (NEGATION.test(line)) return;
    report(
      'R9',
      file,
      index + 1,
      "Revendication de certification ou de conformité sans preuve : la formuler comme non certifiée, ou retirer la mention."
    );
  });
}

/** R10 — les composants/services frontend ne calculent pas le TCO ou les décisions. */
const BROWSER_CALCULATION_PATTERNS = [
  /from\s+['"][^'"]*\/engine\/tcoEngine['"]|require\(\s*['"][^'"]*\/engine\/tcoEngine['"]\s*\)/,
  /\bTCOEngine\b/,
  /\brunAllTCOEngineTests\b/,
  /\bcalculateOfferTCO\b/,
  /\bcalculateBreakEven\b/,
  /\bcalculateSensitivity\b/,
  /\bcalculateScenarios\b/,
];
for (const file of allSource) {
  const relative = path.relative(ROOT, file).split(path.sep).join('/');
  if (!(relative === 'src/App.tsx' || relative.startsWith('src/components/') || relative.startsWith('src/services/'))) continue;
  const content = await fs.readFile(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    if (BROWSER_CALCULATION_PATTERNS.some((pattern) => pattern.test(line))) {
      report('R10', file, index + 1, 'Calcul moteur dans le frontend : afficher le résultat serveur persisté au lieu de recalculer localement.');
    }
  });
}
if (violations.length === 0) {
  console.log(`Contrôles statiques (10 règles) : aucun écart sur ${allSource.length + testFiles.length} fichiers analysés.`);
  process.exit(0);
}

console.error(`Contrôles statiques : ${violations.length} écart(s) à corriger.\n`);
for (const violation of violations) {
  console.error(`  [${violation.rule}] ${violation.file}:${violation.line} — ${violation.message}`);
}
process.exit(1);
