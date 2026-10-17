import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GARDE : l'interface et les données qu'elle produit ne doivent affirmer ni conformité, ni certification, ni
 * validation que le produit n'est pas en mesure d'apporter, et ne doivent contenir ni identité fictive ni
 * capacité simulée. Un échec ici = une allégation à retirer (ou à fonder), pas un test à contourner.
 */
const SRC = path.resolve(__dirname, '../src');
const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));

// Données de démonstration, définitions de types et schémas de validation : exclus de la garde de LIBELLÉS.
const files = walk(SRC).filter((f) => !/[\\/]data[\\/]seedData\.ts$/.test(f) && !/\.test\.tsx?$/.test(f));
const read = (f: string) => fs.readFileSync(f, 'utf8');

const FORBIDDEN: [string, RegExp][] = [
  ['conformité / certification affirmée', /document officiel|piste d['’]audit (fiable )?certifi|horodatage certifi|audit légal|registre d['’]audit immuable|données? certifiées?|source certifiée|référentiel externe certifié|fournisseurs? certifiés? avec|certifiée? (pwa|tco|iso)|formule[^.\n]{0,30}certifiée|valeurs? initiales certifiées/i],
  ['commissaire aux comptes / CAC', /commissaires? aux comptes|\bCAC\b/],
  ['signature / eIDAS / PKI', /eidas|certeurope|secnumcloud|signature électronique qualifiée|\bmtls\b|oauth ?2/i],
  ['scellement / hachage présenté comme preuve', /\bscell|sceau|sha-?256|infalsifiable|inviolable|valeur probante|opposable/i],
  ['jargon interne de projet visible', /chantier [0-9]|\(?section [0-9]+(\.[0-9]+)?\)?|principe 37/i],
  ['conformité normative / réglementaire affirmée', /conforme (à la )?(section|norme iso|csrd|article)|conformité (iso|csrd)|article l\. ?[0-9]/i],
  ['statut décoratif', /\b(Validé|Nouveau|Actif|IA OCR)\b[^a-zé]{0,3}['"`]?\s*(,|\})\s*$/m],
];

describe('Aucune allégation non fondée dans le code applicatif', () => {
  it.each(FORBIDDEN)('%s', (_name, re) => {
    const hits = files.flatMap((f) => read(f).split('\n').map((l, i) => ({ f, i: i + 1, l })).filter(({ l }) => re.test(l)));
    expect(hits.map((h) => `${path.relative(SRC, h.f)}:${h.i}: ${h.l.trim().slice(0, 100)}`)).toEqual([]);
  });

  it('aucune identité fictive en dur dans la logique (auteurs, rôles, ids)', () => {
    const names = /Sophie Valéry|Alexandre Meyer|Éléonore Chen|Lucas Bernard|Delorme|de Mortemart|IA Assistant Achats|u-audit-cac|u-rse|org-acme-fr/;
    const hits = files.filter((f) => !/[\\/]types[\\/]/.test(f)).flatMap((f) => read(f).split('\n').map((l, i) => ({ f, i: i + 1, l })).filter(({ l }) => names.test(l)));
    expect(hits.map((h) => `${path.relative(SRC, h.f)}:${h.i}: ${h.l.trim().slice(0, 100)}`)).toEqual([]);
  });

  it("aucune capacité simulée : pas de handleSimulate*, mock* ni repli heuristique", () => {
    const hits = files.flatMap((f) => read(f).split('\n').map((l, i) => ({ f, i: i + 1, l })).filter(({ l }) => /handleSimulate\w*|simulate(Quote|Extraction|Import)\w*|\bmock\w*\s*[=(:]|fallback-heuristic/i.test(l)));
    expect(hits.map((h) => `${path.relative(SRC, h.f)}:${h.i}: ${h.l.trim().slice(0, 100)}`)).toEqual([]);
  });

  it('les modules supprimés (ERP, signature électronique, CSRD) ne sont plus référencés', () => {
    const hits = files.flatMap((f) => read(f).split('\n').map((l, i) => ({ f, i: i + 1, l })).filter(({ l }) => /erpService|ErpConnectors|signatureService|DigitalSignature|csrdTaxonomy|CsrdTaxonomy|AutomatedTestsModal/.test(l)));
    expect(hits.map((h) => `${path.relative(SRC, h.f)}:${h.i}`)).toEqual([]);
  });

  it("le serveur n'expose plus de route ERP ni de repli IA fictif", () => {
    const server = fs.readdirSync(path.resolve(__dirname, '../server'), { recursive: true, withFileTypes: false }).map(String).filter((f) => f.endsWith('.ts'));
    for (const f of server) {
      const s = fs.readFileSync(path.resolve(__dirname, '../server', f), 'utf8');
      expect(s, f).not.toMatch(/push-award|sync-inbound|fallback-heuristic|Renault Trucks|mTLS/i);
    }
  });
});
