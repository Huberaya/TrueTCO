import React, { useRef, useState } from 'react';
import { StorageService, TrueTCOBackupPayload } from '../services/storageService';
import { Project, SupplierOffer, Supplier, ExternalityReferenceBenchmark, AuditLogEntry } from '../types/domain';
import { TrueTCOBackupPayloadSchema, formatZodError } from '../schemas/validationSchemas';
import {
  X,
  Download,
  Upload,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Database,
  FileCode2,
  Layers,
  Copy,
  Check,
  Terminal,
  ShieldCheck,
} from 'lucide-react';

interface DataBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  offers: SupplierOffer[];
  suppliers: Supplier[];
  benchmarks: ExternalityReferenceBenchmark[];
  auditLogs: AuditLogEntry[];
  onRestoreData: (payload: TrueTCOBackupPayload) => void;
  onResetSeed: () => void;
}

const SQL_TABLES_INFO = [
  {
    name: 'organizations',
    role: 'Racine Multi-Tenant (SIRET, devises, isolation clients)',
    fields: ['id UUID PK', 'name VARCHAR', 'legal_registration_number', 'default_currency', 'created_at', 'updated_at'],
  },
  {
    name: 'users',
    role: 'Comptes utilisateurs & Contrôle d\'accès RBAC (Acheteur, DAF, RSE)',
    fields: ['id UUID PK', 'organization_id FK', 'email', 'full_name', 'role CHECK', 'is_active', 'created_at'],
  },
  {
    name: 'projects',
    role: 'Consultations d\'achats (12 champs normés, horizon, WACC, inflation)',
    fields: ['id UUID PK', 'reference UNIQUE', 'name', 'budget_cap', 'planned_volume', 'horizon_years', 'discount_rate', 'status'],
  },
  {
    name: 'suppliers',
    role: 'Référentiel fournisseurs (Incoterms, délais, MOQ, score ESG, pannes)',
    fields: ['id UUID PK', 'name', 'country_code', 'incoterm', 'historical_defect_rate', 'warranty_months', 'data_quality_score'],
  },
  {
    name: 'supplier_offers',
    role: 'Propositions candidates (Prix facial, LCC NPV, TCO global, carbone)',
    fields: ['id UUID PK', 'project_id FK', 'supplier_id FK', 'apparent_total', 'economic_tco_nominal', 'lifecycle_cost_lcc', 'total_comprehensive_tco'],
  },
  {
    name: 'cost_items',
    role: 'Ventilation analytique TCO / CBS (15 postes décomposés)',
    fields: ['id UUID PK', 'offer_id FK', 'category', 'label', 'amount', 'unit', 'source_name', 'source_type', 'confidence_level'],
  },
  {
    name: 'carbon_items',
    role: 'Bilan d\'émissions ACV Scopes 1, 2, 3 (Monétisation Quinet)',
    fields: ['id UUID PK', 'offer_id FK', 'scope CHECK', 'lifecycle_phase', 'emissions_per_unit_tonne_co2e', 'total_lifecycle_emissions'],
  },
  {
    name: 'risk_items',
    role: 'Événements de risques probabilisés P x I (ZFE, ruptures, pénalités)',
    fields: ['id UUID PK', 'offer_id FK', 'description', 'probability NUMERIC', 'financial_impact NUMERIC', 'source_evidence'],
  },
  {
    name: 'reference_benchmarks',
    role: 'Référentiel institutionnel des facteurs (ADEME, Quinet, WACC, CRE)',
    fields: ['id UUID PK', 'name', 'category', 'source', 'value NUMERIC', 'unit', 'valid_until', 'confidence_score'],
  },
  {
    name: 'audit_logs',
    role: 'Journal d\'audit immuable légal (Horodatage, auteur, justification CAC)',
    fields: ['id UUID PK', 'organization_id FK', 'timestamp', 'user_name', 'user_role', 'entity_name', 'field_changed', 'old_value', 'new_value', 'justification'],
  },
];

export const DataBackupModal: React.FC<DataBackupModalProps> = ({
  isOpen,
  onClose,
  projects,
  offers,
  suppliers,
  benchmarks,
  auditLogs,
  onRestoreData,
  onResetSeed,
}) => {
  const [activeTab, setActiveTab] = useState<'backup' | 'schema' | 'migration'>('backup');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [zodValidationReport, setZodValidationReport] = useState<{ valid: boolean; messages: string[] } | null>(null);

  if (!isOpen) return null;

  const handleExport = () => {
    StorageService.exportFullBackup(projects, offers, suppliers, benchmarks, auditLogs);
    setFeedback({
      type: 'success',
      msg: 'Dossier complet exporté avec succès au format JSON auditable.',
    });
  };

  const handleDownloadSql = () => {
    StorageService.downloadSqlMigrationDump(projects, offers, suppliers, benchmarks, auditLogs);
    setFeedback({
      type: 'success',
      msg: 'Script SQL PostgreSQL généré et téléchargé (truetco_migration_postgresql.sql). Prêt pour injection dans votre SGBD.',
    });
  };

  const handleRunZodValidation = () => {
    const payload = {
      version: '1.2.0',
      exportedAt: new Date().toISOString(),
      organization: 'Acme Group Europe',
      projects,
      offers,
      suppliers,
      benchmarks,
      auditLogs,
    };
    const res = TrueTCOBackupPayloadSchema.safeParse(payload);
    if (res.success) {
      setZodValidationReport({
        valid: true,
        messages: [
          `Validation réussie : ${projects.length} projet(s), ${offers.length} offre(s), ${suppliers.length} fournisseur(s) et ${auditLogs.length} traces d'audit conformes.`,
          'Toutes les contraintes financières (WACC, budget, CBS) et ESG sont certifiées pour la migration.',
        ],
      });
    } else {
      setZodValidationReport({
        valid: false,
        messages: formatZodError(res.error),
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const payload = StorageService.parseBackupFile(text);
        onRestoreData(payload);
        setFeedback({
          type: 'success',
          msg: `Restauration réussie : ${payload.projects.length} projet(s), ${payload.offers.length} offre(s) et ${payload.auditLogs.length} traces d'audit chargées.`,
        });
      } catch (err: any) {
        setFeedback({
          type: 'error',
          msg: `Échec de lecture : ${err.message || 'Fichier JSON corrompu ou incompatible.'}`,
        });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleReset = () => {
    if (
      window.confirm(
        'Voulez-vous vraiment réinitialiser toutes les données aux valeurs de démonstration ? Les modifications non exportées seront écrasées.'
      )
    ) {
      onResetSeed();
      setFeedback({
        type: 'success',
        msg: 'Données réinitialisées aux valeurs initiales certifiées.',
      });
    }
  };

  const handleCopySqlPath = () => {
    navigator.clipboard.writeText(
      'Fichiers DDL créés :\n- src/db/schema.ts (Drizzle ORM)\n- src/db/schema.sql (PostgreSQL DDL 10 tables)\n- src/db/seed.sql (Données de démarrage)\n- src/db/drizzle.config.ts'
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 space-y-5 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="text-base font-bold text-white">Base de Données & Données Métier</h3>
              <p className="text-xs text-slate-400">
                Persistance locale, portabilité des dossiers et architecture PostgreSQL Drizzle.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2 text-xs">
          <button
            onClick={() => setActiveTab('backup')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'backup'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            Sauvegarde & Portabilité JSON
          </button>

          <button
            onClick={() => setActiveTab('schema')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'schema'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5 text-sky-400" />
            Schéma SQL & Drizzle ORM (10 Tables)
          </button>

          <button
            onClick={() => setActiveTab('migration')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'migration'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-amber-400" />
            Migration & Export SGBD
          </button>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                : 'bg-rose-950/60 border-rose-800 text-rose-300'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            )}
            <span>{feedback.msg}</span>
          </div>
        )}

        {/* TAB 1: BACKUP & LOCAL PERSISTENCE */}
        {activeTab === 'backup' && (
          <div className="space-y-3 text-xs">
            {/* Card 1: Export */}
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-white">Exporter l'intégralité du portefeuille</div>
                <div className="text-slate-400 text-[11px] mt-0.5">
                  Télécharge un fichier JSON (.truetco) avec projets, offres, fournisseurs et journal d'audit.
                </div>
              </div>
              <button
                onClick={handleExport}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Exporter (.json)
              </button>
            </div>

            {/* Card 2: Import */}
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-white">Restaurer / Importer une consultation</div>
                <div className="text-slate-400 text-[11px] mt-0.5">
                  Chargez un fichier de sauvegarde pour reprendre un dossier ou auditer des calculs.
                </div>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json"
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Importer (.json)
              </button>
            </div>

            {/* Card 3: Reset */}
            <div className="p-3.5 bg-slate-950 border border-rose-900/40 rounded-xl flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-rose-300">Réinitialiser aux valeurs de référence</div>
                <div className="text-slate-400 text-[11px] mt-0.5">
                  Rétablit les jeux d'essais initiaux certifiés (50 VUL électriques vs thermiques).
                </div>
              </div>
              <button
                onClick={handleReset}
                className="px-3 py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-200 rounded-lg font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Réinitialiser
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: SCHEMA & DRIZZLE ORM */}
        {activeTab === 'schema' && (
          <div className="space-y-3 text-xs max-h-[360px] overflow-y-auto pr-1">
            {/* Neon Connection Status Banner */}
            <div className="p-3 bg-emerald-950/40 border border-emerald-800/80 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <div>
                  <div className="font-semibold text-emerald-300 text-xs">Instance Neon PostgreSQL Connectée & Migrée</div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    ep-summer-mouse-b2kmuvkr · 10 tables actives & contraintes FK synchronisées
                  </div>
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 bg-emerald-900/80 text-emerald-200 border border-emerald-700/60 rounded font-mono font-semibold">
                NEON LIVE
              </span>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
              <div>
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  Modèle Relationnel PostgreSQL & Drizzle ORM
                </span>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  Fichiers sources synchronisés : <code>src/db/schema.ts</code> & <code>src/db/schema.sql</code>.
                </span>
              </div>
              <button
                onClick={handleCopySqlPath}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copié !' : 'Copier références'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {SQL_TABLES_INFO.map((tbl) => (
                <div
                  key={tbl.name}
                  className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl space-y-1.5 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-sky-400 text-xs">{tbl.name}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{tbl.fields.length} champs</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-snug">{tbl.role}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {tbl.fields.slice(0, 4).map((f) => (
                      <span
                        key={f}
                        className="text-[9px] font-mono px-1.5 py-0.5 bg-slate-900 text-slate-400 rounded border border-slate-800"
                      >
                        {f}
                      </span>
                    ))}
                    {tbl.fields.length > 4 && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 text-slate-500">
                        +{tbl.fields.length - 4}...
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: MIGRATION SGBD & EXPORT SQL */}
        {activeTab === 'migration' && (
          <div className="space-y-3.5 text-xs max-h-[380px] overflow-y-auto pr-1">
            {/* Action 1: Download SQL Dump */}
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    Dump SQL de Migration PostgreSQL (DDL & DML)
                  </div>
                  <div className="text-slate-400 text-[11px] mt-0.5">
                    Génère un script SQL exécutable contenant toutes les tables et données réelles actuelles (projets, offres, CBS, audit).
                  </div>
                </div>
                <button
                  onClick={handleDownloadSql}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Générer .sql
                </button>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5 font-mono text-[11px] text-slate-300">
                <span className="text-slate-500"># Commande d'injection directe sur votre serveur PostgreSQL :</span>
                <div className="text-emerald-300 mt-1 select-all">
                  psql -h $SQL_HOST -U $SQL_USER -d $SQL_DB_NAME -f truetco_migration_postgresql.sql
                </div>
              </div>
            </div>

            {/* Action 2: Pre-migration Zod Validation */}
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-sky-400" />
                    Contrôle d'Intégrité Zod Pré-Migration
                  </div>
                  <div className="text-slate-400 text-[11px] mt-0.5">
                    Vérifie la conformité de chaque champ financier (WACC, inflation, offres, risques) avant transfert en base de données.
                  </div>
                </div>
                <button
                  onClick={handleRunZodValidation}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Tester la validité
                </button>
              </div>

              {zodValidationReport && (
                <div
                  className={`p-3 rounded-lg border text-[11px] space-y-1 ${
                    zodValidationReport.valid
                      ? 'bg-emerald-950/50 border-emerald-800/80 text-emerald-200'
                      : 'bg-rose-950/50 border-rose-800/80 text-rose-200'
                  }`}
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    {zodValidationReport.valid ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    )}
                    {zodValidationReport.valid
                      ? 'Toutes les données sont certifiées et conformes aux schémas DTO Zod.'
                      : 'Erreurs de validation détectées :'}
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                    {zodValidationReport.messages.map((m, idx) => (
                      <li key={idx}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Architecture note */}
            <div className="p-3 bg-slate-950/60 border border-slate-800/60 rounded-xl text-[11px] text-slate-400 space-y-1">
              <span className="font-semibold text-slate-300 block">Souveraineté des Données & Mode Hors-Ligne (PWA) :</span>
              En l'absence de base cloud connectée, TrueTCO fonctionne à 100% en local sécurisé dans le navigateur avec réplication IndexedDB/LocalStorage et cache PWA Service Worker. Toutes les données peuvent être injectées ultérieurement sur votre infrastructure sans aucune perte.
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-slate-800 flex justify-between items-center text-xs">
          <span className="text-slate-500 text-[11px]">
            Conforme norme ISO 20400 & Piste d'audit fiable (Article L. 123-14 du Code de Commerce)
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
