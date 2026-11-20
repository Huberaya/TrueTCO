import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import test from 'node:test';
import { StorageService, type PostgresSqlExportOrganizationContext } from './storageService';
import type {
  AuditLogEntry,
  AuditedValue,
  CarbonFootprintItem,
  CostBreakdownItem,
  ExternalityReferenceBenchmark,
  Project,
  RiskExpositionItem,
  Supplier,
  SupplierOffer,
} from '../types/domain';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const date = '2026-11-10T12:00:00.000Z';

function audited(value: number, unit: string): AuditedValue<number> {
  return { value, unit, sourceType: 'verifiee', sourceName: 'fixture source', confidenceLevel: 95, lastUpdated: date, updatedBy: 'fixture' };
}

function project(organizationId: string, key: number): Project {
  return {
    id: id(key), organizationId, name: `Project ${key}`, companyName: `Company ${key}`, reference: `P-${key}`,
    category: 'informatique_it', budgetCap: 10000, currency: 'EUR', horizonYears: 3, plannedVolume: 10,
    unitName: 'poste', purchaseFrequency: 'unique', objective: 'fixture', ownerId: 'owner-local', ownerName: 'Fixture Owner',
    status: 'brouillon', createdAt: date, updatedAt: date, discountRate: 0.04, carbonScenario: 'central',
    carbonPricePerTonne: 120, inflationRate: 0.02, energyInflationRate: 0.03,
  };
}

function supplier(organizationId: string, key: number): Supplier {
  return {
    id: id(key), organizationId, name: `Supplier ${key}`, country: 'FR', sector: 'IT', contactName: 'Contact',
    contactEmail: `supplier${key}@example.invalid`, certifications: ['ISO 14001', `Supplier's certificate ${key}`],
    defaultIncoterm: 'DDP', currency: 'EUR', paymentTerms: '30', moq: 1, leadTimeDays: 20,
    historicalDefectRate: 0.01, warrantyMonths: 24, performanceScore: 90, esgScore: 80,
    environmentalDataAvailable: ['Supplier statement'], dataQualityScore: 90,
  };
}

function costItem(key: number): CostBreakdownItem {
  return { id: id(key), category: 'acquisition', label: `Cost ${key}`, amount: audited(125, 'EUR/unit'), isRecurringYearly: false };
}

function carbonItem(): CarbonFootprintItem {
  return {
    scope: 'Scope 3 - Amont', lifecyclePhase: 'fabrication', emissionsPerUnitTonneCO2e: audited(0.25, 'tCO2e/unit'),
    totalLifecycleEmissions: 2.5, emissionFactorSource: 'ADEME fixture',
  };
}

function riskItem(key: number): RiskExpositionItem {
  return {
    id: id(key), label: `Risk ${key}`, category: 'interruption_service', probability: audited(0.1, 'probability'),
    financialImpact: audited(500, 'EUR'), expectedLoss: 50, probabilityType: 'historique',
  };
}

function offer(projectId: string, supplierId: string, key: number): SupplierOffer {
  return {
    id: id(key), projectId, supplierId, supplierName: `Supplier for ${key}`, offerReference: `O-${key}`,
    isResponsibleCandidate: false, apparentUnitPrice: audited(125, 'EUR/unit'), quantity: 10, apparentTotal: 1250,
    deliveryLeadTimeWeeks: 4, warrantyMonths: 24, expectedLifespanYears: 5,
    costItems: [costItem(key + 20)], carbonItems: [carbonItem()], riskItems: [riskItem(key + 40)],
    technicalSuitabilityScore: 85,
  };
}

function benchmark(organizationId: string, key: number): ExternalityReferenceBenchmark {
  return {
    id: id(key), organizationId, validUntil: '2027-12-31T00:00:00.000Z', lastAuditDate: date,
    name: `Benchmark ${key}`, category: 'carbone', value: 120, unit: 'EUR/tCO2e', source: 'ADEME fixture',
    documentRef: `DOC-${key}`, lastUpdated: date, countryScope: 'FR', methodology: 'fixture', confidenceLevel: 90,
  };
}

function auditLog(organizationId: string, projectId: string, key: number): AuditLogEntry {
  return {
    id: id(key), organizationId, timestamp: date, userId: id(key + 100), userName: `User ${key}`, userRole: 'acheteur',
    projectId, entityName: 'Project', fieldChanged: 'budget', oldValue: '100', newValue: '120', justification: 'fixture change',
  };
}

const organizationA: PostgresSqlExportOrganizationContext = {
  organizationId: id(1), name: "Organisation d'A", legalRegistrationNumber: null, countryCode: 'FR', defaultCurrency: 'EUR',
};
const organizationB: PostgresSqlExportOrganizationContext = {
  organizationId: id(2), name: 'Organisation B', legalRegistrationNumber: null, countryCode: 'DE', defaultCurrency: 'EUR',
};
const projectA = project(organizationA.organizationId, 3);
const projectB = project(organizationB.organizationId, 4);
const supplierA = supplier(organizationA.organizationId, 5);
const supplierB = supplier(organizationB.organizationId, 6);
const offerA = offer(projectA.id, supplierA.id, 7);
const offerB = offer(projectB.id, supplierB.id, 8);
const benchmarkA = benchmark(organizationA.organizationId, 13);
const benchmarkB = benchmark(organizationB.organizationId, 14);
const auditA = auditLog(organizationA.organizationId, projectA.id, 15);
const auditB = auditLog(organizationB.organizationId, projectB.id, 16);

function generate(context: PostgresSqlExportOrganizationContext, overrides: {
  projects?: Project[];
  offers?: SupplierOffer[];
  suppliers?: Supplier[];
  benchmarks?: ExternalityReferenceBenchmark[];
  auditLogs?: AuditLogEntry[];
} = {}) {
  return StorageService.generatePostgresMigrationSql(
    overrides.projects ?? [projectA, projectB],
    overrides.offers ?? [offerA, offerB],
    overrides.suppliers ?? [supplierA, supplierB],
    overrides.benchmarks ?? [benchmarkA, benchmarkB],
    overrides.auditLogs ?? [auditA, auditB],
    context,
  );
}

test('tenant SQL export requires explicit organization context and refuses incoherent data before creating a file', () => {
  assert.throws(
    () => StorageService.generatePostgresMigrationSql([projectA], [offerA], [supplierA], [], []),
    /aucun contexte organisationnel vérifié/,
  );
  assert.throws(
    () => StorageService.downloadSqlMigrationDump([projectA], [offerA], [supplierA], [], []),
    /aucun contexte organisationnel vérifié/,
  );
  assert.throws(
    () => generate(organizationA, { suppliers: [supplierA], offers: [offer(projectA.id, supplierB.id, 17)] }),
    /fournisseur absent/,
  );
  assert.throws(
    () => generate(organizationA, {
      suppliers: [supplierA, supplierB],
      offers: [offer(projectA.id, supplierB.id, 17)],
    }),
    /organisations différentes/,
  );
  assert.throws(
    () => generate(organizationA, { benchmarks: [{ ...benchmarkA, organizationId: undefined }] }),
    /organizationId doit être un UUID valide/,
  );
  assert.throws(
    () => generate(organizationA, { auditLogs: [{ ...auditA, projectId: projectB.id }] }),
    /projet absent ou d’une autre organisation/,
  );
  assert.throws(
    () => generate(organizationA, { suppliers: [{ ...supplierA, country: 'France' }], offers: [], auditLogs: [] }),
    /code pays ISO alpha-2/,
  );
  assert.throws(
    () => generate(organizationA, { suppliers: [{ ...supplierA, paymentTerms: '30 jours fin de mois' }], offers: [], auditLogs: [] }),
    /sans hypothèse/,
  );
});

test('two organization exports contain only matching parents, offers and tenant-tagged child rows', async () => {
  const sqlA = generate(organizationA);
  const sqlB = generate(organizationB);
  assert.doesNotMatch(sqlA, /00000000-0000-0000-0000-000000000001/);
  assert.match(sqlA, new RegExp(organizationA.organizationId));
  assert.doesNotMatch(sqlA, new RegExp(organizationB.organizationId));
  assert.match(sqlB, new RegExp(organizationB.organizationId));
  assert.doesNotMatch(sqlB, new RegExp(organizationA.organizationId));
  assert.match(sqlA, /supplier_offers \(id, organization_id, project_id, supplier_id/);
  assert.match(sqlA, /cost_items \(id, organization_id, offer_id/);
  assert.match(sqlA, /carbon_items \(organization_id, offer_id/);
  assert.match(sqlA, /risk_items \(id, organization_id, offer_id/);
  assert.match(sqlA, /audit_logs \(id, organization_id/);
  assert.match(sqlA, /reference_benchmarks \(id, organization_id/);
  assert.match(sqlA, /'Organisation d''A'/, 'quotes in organisation labels must be SQL-escaped once');

  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const db = new PGlite();
  try {
    await db.exec(schema);
    await db.exec(sqlA);
    await db.exec(sqlB);
    for (const organizationId of [organizationA.organizationId, organizationB.organizationId]) {
      const aggregate = (await db.query<Record<string, unknown>>(
        `SELECT
          (SELECT count(*)::int FROM projects WHERE organization_id = $1) AS projects,
          (SELECT count(*)::int FROM suppliers WHERE organization_id = $1) AS suppliers,
          (SELECT count(*)::int FROM supplier_offers WHERE organization_id = $1) AS offers,
          (SELECT count(*)::int FROM cost_items WHERE organization_id = $1) AS costs,
          (SELECT count(*)::int FROM carbon_items WHERE organization_id = $1) AS carbon,
          (SELECT count(*)::int FROM risk_items WHERE organization_id = $1) AS risks,
          (SELECT count(*)::int FROM reference_benchmarks WHERE organization_id = $1) AS benchmarks,
          (SELECT count(*)::int FROM audit_logs WHERE organization_id = $1) AS audit_logs`,
        [organizationId],
      )).rows[0];
      assert.deepEqual(aggregate, { projects: 1, suppliers: 1, offers: 1, costs: 1, carbon: 1, risks: 1, benchmarks: 1, audit_logs: 1 });
      const links = (await db.query<Record<string, unknown>>(
        `SELECT count(*)::int AS count
         FROM supplier_offers o
         JOIN projects p ON p.id = o.project_id AND p.organization_id = o.organization_id
         JOIN suppliers s ON s.id = o.supplier_id AND s.organization_id = o.organization_id
         JOIN cost_items c ON c.offer_id = o.id AND c.organization_id = o.organization_id
         JOIN carbon_items e ON e.offer_id = o.id AND e.organization_id = o.organization_id
         JOIN risk_items r ON r.offer_id = o.id AND r.organization_id = o.organization_id
         WHERE o.organization_id = $1`,
        [organizationId],
      )).rows[0].count;
      assert.equal(links, 1, 'offer and all child relations must remain within the exported organization');
    }
    const actorSnapshot = (await db.query<Record<string, unknown>>('SELECT user_id, user_name, user_role FROM audit_logs WHERE id = $1', [auditA.id])).rows[0];
    assert.deepEqual(actorSnapshot, { user_id: null, user_name: auditA.userName, user_role: auditA.userRole });
  } finally {
    await db.close();
  }
});
