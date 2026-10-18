import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { TCOEngine } from '../../src/engine/tcoEngine';
import { ExcelExportService } from '../../src/services/excelExportService';
import { buildReproducibleSheet, colLetter, isFormula } from '../../src/services/reproducibleSheet';
import { carbon, item, offer, project, risk } from './fixtures';

describe('Export Excel : feuilles de formules', () => {
  it('colLetter : A, Z, AA, AB…', () => {
    expect([0, 25, 26, 27, 51, 52].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });

  it("RÉGRESSION : les formules survivent à l'écriture du fichier xlsx (SheetJS supprime celles sans valeur en cache)", () => {
    const o = offer({ items: [item('acquisition', 1000), item('energie_consommables', 100, { recurring: true })], risks: [risk(0.5, 100)], carbons: [carbon('utilisation_annuelle', 6)] });
    const { grid, kpi } = buildReproducibleSheet(project(), o);
    const expected = grid.flat().filter(isFormula).length;
    expect(expected).toBeGreaterThan(20);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ExcelExportService.formulaWorksheet(grid), 'T');
    const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellFormula: true }).Sheets.T;

    const survived = Object.entries(back).filter(([k, c]) => !k.startsWith('!') && (c as XLSX.CellObject).f).length;
    expect(survived).toBe(expected);
    // la formule du coût complet actualisé est bien une SOMME, avec sa valeur en cache
    const lccCell = back[`${colLetter(kpi.lcc.col)}${kpi.lcc.row + 1}`] as XLSX.CellObject;
    expect(lccCell.f).toMatch(/^SUM\(/);
    expect(lccCell.v).toBeCloseTo(TCOEngine.calculateOfferTCO(project(), o).exact.lifecycleCostLCC, 6);   // valeur en cache = moteur
  });
});
