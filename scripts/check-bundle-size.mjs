#!/usr/bin/env node
/**
 * TrueTCO — Contrôle de la taille du paquet
 * ---------------------------------------------------------------------------
 * Le paquet initial pesait plus d'un mégaoctet en un seul fichier. Ce contrôle
 * échoue si le JavaScript livré au navigateur dépasse un plafond : la
 * performance est une exigence produit, pas une intention.
 *
 * Le seuil est volontairement visible et modifiable dans le dépôt : il doit être
 * abaissé avec le découpage du code, jamais relevé sans décision écrite.
 */
import fs from 'fs/promises';
import path from 'path';

const LIMIT_KB = Number(process.env.TRUETCO_BUNDLE_LIMIT_KB ?? 1500);
const WARN_KB = Number(process.env.TRUETCO_BUNDLE_WARN_KB ?? 1100);
const distDir = path.resolve(process.cwd(), 'dist');

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

let files;
try {
  files = await walk(distDir);
} catch {
  console.error('Aucun build trouvé dans dist/. Lancez « npm run build » avant ce contrôle.');
  process.exit(1);
}

const assets = files.filter((file) => /\.(js|css)$/.test(file));
if (assets.length === 0) {
  console.error('Aucun fichier JS/CSS dans dist/ : le build est incomplet.');
  process.exit(1);
}

const measured = [];
for (const file of assets) {
  const stats = await fs.stat(file);
  measured.push({ file: path.relative(distDir, file), kb: stats.size / 1024 });
}
measured.sort((a, b) => b.kb - a.kb);

const totalKb = measured.reduce((sum, entry) => sum + entry.kb, 0);
console.log(`Fichiers livrés : ${measured.length}`);
for (const entry of measured.slice(0, 6)) {
  console.log(`  ${entry.file.padEnd(48)} ${entry.kb.toFixed(1)} Ko`);
}
console.log(`Total : ${totalKb.toFixed(1)} Ko (plafond ${LIMIT_KB} Ko)`);

if (totalKb > WARN_KB && totalKb <= LIMIT_KB) {
  console.warn(
    `ATTENTION : le total dépasse le seuil d'alerte de ${WARN_KB} Ko. Réduire par découpage du code (imports dynamiques) plutôt qu'en relevant le plafond.`
  );
}

if (totalKb > LIMIT_KB) {
  console.error(`ÉCHEC : ${totalKb.toFixed(1)} Ko > plafond de ${LIMIT_KB} Ko.`);
  process.exit(1);
}
console.log('Taille du paquet conforme.');
