#!/usr/bin/env node
/**
 * TrueTCO — Contrôle de la taille du paquet
 * ---------------------------------------------------------------------------
 * Le paquet initial pesait plus d'un mégaoctet en un seul fichier. Ce contrôle
 * rapporte le shell statique, alerte lorsque la somme JS/CSS livrée dépasse le
 * seuil d'attention, et échoue au-delà du plafond total (chunks différés compris).
 *
 * Les seuils sont visibles et modifiables dans le dépôt ; le plafond total ne
 * doit pas être relevé pour masquer un découpage de code insuffisant.
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

// Mesure distincte du shell statique JS/CSS référencé dans index.html.
// Une vue React.lazy peut être demandée dès son montage ; ses chunks sont hors de
// cette sous-mesure, mais restent dans le seuil d'attention et le plafond total.
const html = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
const initialReferences = new Set();
for (const match of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
  const tag = match[0];
  const isModuleScript = /<script\b/i.test(tag) && /type=["']module["']/i.test(tag);
  const isInitialLink = /<link\b/i.test(tag) && /rel=["'](?:stylesheet|modulepreload)["']/i.test(tag);
  if (!isModuleScript && !isInitialLink) continue;
  const reference = tag.match(/(?:src|href)=["']([^"']+)["']/i)?.[1];
  if (reference && !/^(?:https?:)?\/\//i.test(reference) && !reference.startsWith('data:')) {
    initialReferences.add(path.normalize(reference.split('?')[0].replace(/^[/\\]+/, '')));
  }
}
const initialAssets = measured.filter((entry) => initialReferences.has(path.normalize(entry.file)));
const initialKb = initialAssets.reduce((sum, entry) => sum + entry.kb, 0);

console.log(`Fichiers livrés (entrée + chunks différés) : ${measured.length}`);
for (const entry of measured.slice(0, 6)) {
  console.log(`  ${entry.file.padEnd(48)} ${entry.kb.toFixed(1)} Ko`);
}
console.log(`Shell statique (assets référencés par index.html) : ${initialKb.toFixed(1)} Ko (mesure informative)`);
console.log(`Total livré, chunks différés compris : ${totalKb.toFixed(1)} Ko (alerte ${WARN_KB} Ko, plafond ${LIMIT_KB} Ko)`);

if (initialReferences.size === 0) {
  console.error('Aucun asset JS/CSS initial n’a été trouvé dans dist/index.html : mesure du chargement initial impossible.');
  process.exit(1);
}
if (initialAssets.length !== initialReferences.size) {
  const missing = [...initialReferences].filter((reference) => !measured.some((entry) => path.normalize(entry.file) === reference));
  console.error(`Impossible de mesurer tous les assets initiaux : ${missing.join(', ')}`);
  process.exit(1);
}
if (totalKb > WARN_KB && totalKb <= LIMIT_KB) {
  console.warn(
    `ATTENTION : le total livré dépasse le seuil d'alerte de ${WARN_KB} Ko. Réduisez le paquet, sans relever le plafond.`
  );
}

if (totalKb > LIMIT_KB) {
  console.error(`ÉCHEC : ${totalKb.toFixed(1)} Ko > plafond de ${LIMIT_KB} Ko.`);
  process.exit(1);
}
console.log('Taille du paquet conforme.');
