import { describe, expect, it } from 'vitest';
import { TCOEngine } from '../src/engine/tcoEngine';
import { PROVENANCE_CONFIDENCE } from '../src/constants/provenance';
import { buildOffer, parseOfferCsv, type OfferInputValues } from '../src/services/offerImport';

const supplier: any = { id: 'sup-1', name: 'Fournisseur Exemple', country: 'FR' };
const project: any = { id: 'p1', horizonYears: 5, discountRate: 0.05, carbonPricePerTonne: 100, inflationRate: 0.02, energyInflationRate: 0.03, plannedVolume: 10, unitName: 'u' };
const HEADER = 'fournisseur;reference;prix_unitaire;quantite;energie_annuelle;maintenance_annuelle;valeur_residuelle;garantie_mois;delai_semaines;duree_vie_ans;adequation_technique;responsable;co2_unitaire_an';
const ROW = 'Fournisseur Exemple;R1;1000;10;500;200;300;24;6;8;70;oui;1,5';

describe('parseOfferCsv — analyse réelle', () => {
  it('ligne valide : valeurs lues, virgule décimale acceptée', () => {
    const [r] = parseOfferCsv(`${HEADER}\n${ROW}`, [supplier]);
    expect(r.errors).toEqual([]);
    expect(r.values).toMatchObject({ supplierId: 'sup-1', unitPrice: 1000, quantity: 10, carbonTonnePerUnitYear: 1.5, isResponsibleCandidate: true });
  });

  it("RÉGRESSION : un CSV différent donne des valeurs différentes (l'ancien import ignorait le CSV)", () => {
    const [a] = parseOfferCsv(`${HEADER}\n${ROW}`, [supplier]);
    const [b] = parseOfferCsv(`${HEADER}\n${ROW.replace(';1000;', ';2222;')}`, [supplier]);
    expect(a.values!.unitPrice).toBe(1000);
    expect(b.values!.unitPrice).toBe(2222);
  });

  it("RÉGRESSION : une cellule vide n'est JAMAIS complétée automatiquement : elle est signalée", () => {
    const [r] = parseOfferCsv(`${HEADER}\n${ROW.replace(';500;', ';;')}`, [supplier]);
    expect(r.values).toBeUndefined();
    expect(r.errors.join(' ')).toMatch(/energie_annuelle/);
  });

  it.each([
    ['fournisseur inconnu', ROW.replace('Fournisseur Exemple', 'Inconnu SA'), /non référencé/],
    ['texte à la place du nombre', ROW.replace(';1000;', ';mille;'), /prix_unitaire/],
    ['quantité fractionnaire', ROW.replace(';10;500', ';1.5;500'), /quantite/],
    ['adéquation hors bornes', ROW.replace(';70;oui', ';170;oui'), /adequation_technique/],
  ])('%s => erreur explicite', (_n, row, re) => {
    const [r] = parseOfferCsv(`${HEADER}\n${row}`, [supplier]);
    expect(r.errors.join(' ')).toMatch(re);
  });

  it('colonnes manquantes et texte quelconque : refusés (plus de « ligne valide » pour n\'importe quoi)', () => {
    expect(parseOfferCsv('nimporte quoi', [supplier])[0].errors.length).toBeGreaterThan(0);
    expect(parseOfferCsv('fournisseur;reference\nA;B', [supplier])[0].errors[0]).toMatch(/Colonnes manquantes/);
  });

  it('plusieurs lignes : chacune est évaluée séparément', () => {
    const rows = parseOfferCsv(`${HEADER}\n${ROW}\n${ROW.replace('Fournisseur Exemple', 'X')}`, [supplier]);
    expect(rows.map((r) => r.errors.length === 0)).toEqual([true, false]);
  });
});

describe('buildOffer — aucune donnée fabriquée', () => {
  const v: OfferInputValues = { supplierId: 'sup-1', offerReference: 'R1', unitPrice: 1000, quantity: 10, annualEnergy: 500, annualMaintenance: 200, salvageValue: 300,
    warrantyMonths: 24, deliveryLeadTimeWeeks: 6, expectedLifespanYears: 8, technicalSuitabilityScore: 70, isResponsibleCandidate: false };

  it("provenance « fournie par l'utilisateur », avec l'auteur réel et sans confiance usurpée", () => {
    const o = buildOffer(v, project, supplier, 'Camille Test', 'Saisie manuelle');
    for (const c of o.costItems) {
      expect(c.amount.sourceType).toBe('utilisateur');
      expect(c.amount.updatedBy).toBe('Camille Test');
      expect(c.amount.confidenceLevel).toBe(PROVENANCE_CONFIDENCE.userEntered);
    }
    expect(JSON.stringify(o)).not.toMatch(/Sophie|Alexandre|Éléonore|ADEME|IA Assistant|certifi/);
  });

  it('RÉGRESSION : aucun risque inventé, aucun facteur carbone sans valeur saisie, score technique = celui de l\'utilisateur', () => {
    const o = buildOffer(v, project, supplier, 'C', 'Saisie');
    expect(o.riskItems).toEqual([]);
    expect(o.carbonItems).toEqual([]);
    expect(o.technicalSuitabilityScore).toBe(70);
    const withCarbon = buildOffer({ ...v, carbonTonnePerUnitYear: 2 }, project, supplier, 'C', 'Saisie');
    expect(withCarbon.carbonItems).toHaveLength(1);
    expect(withCarbon.carbonItems[0].emissionFactorSource).toMatch(/non précisée/);
  });

  it('valeur résiduelle négative, postes annuels sur tout l\'horizon, total = prix × quantité', () => {
    const o = buildOffer(v, project, supplier, 'C', 'Saisie');
    expect(o.costItems.find((c) => c.category === 'valeur_residuelle')!.amount.value).toBe(-300);
    expect(o.costItems.find((c) => c.category === 'energie_consommables')!.yearOccurrences).toEqual([1, 2, 3, 4, 5]);
    expect(o.apparentTotal).toBe(10000);
  });

  it('une offre construite est exploitable par le moteur (résultats finis)', () => {
    const o = buildOffer({ ...v, carbonTonnePerUnitYear: 2 }, project, supplier, 'C', 'Saisie');
    const r: any = TCOEngine.calculateOfferTCO(project, o);
    expect(Number.isFinite(r.totalComprehensiveTCO)).toBe(true);
    expect(Number.isFinite(r.lifecycleCostLCC)).toBe(true);
  });
});
