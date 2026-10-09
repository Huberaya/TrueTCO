import React, { useRef, useState } from 'react';
import { StorageService, TrueTCOBackupPayload } from '../services/storageService';
import { ApiError, fetchHealth } from '../services/serverData';
import { Project, SupplierOffer, Supplier, ExternalityReferenceBenchmark, AuditLogEntry } from '../types/domain';
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
} from 'lucide-react';

interface DataBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  offers: SupplierOffer[];
  suppliers: Supplier[];
  benchmarks: ExternalityReferenceBenchmark[];
  auditLogs: AuditLogEntry[];
  isLocalDemo: boolean;
  onRestoreData: (payload: TrueTCOBackupPayload) => void;
  onResetSeed: () => void;
}

/*
  Le tableau « SQL_TABLES_INFO » a été retiré : il listait des tables et des
  colonnes qui n'existent pas dans le schéma réel (par exemple
  `economic_tco_nominal` ou `total_comprehensive_tco`), ce qui laissait croire à
  un modèle de données vérifié. Le schéma réel se lit dans src/db/migrations.
*/

export const DataBackupModal: React.FC<DataBackupModalProps> = ({
  isOpen,
  onClose,
  projects,
  offers,
  suppliers,
  benchmarks,
  auditLogs,
  isLocalDemo,
  onRestoreData,
  onResetSeed,
}) => {
  const [activeTab, setActiveTab] = useState<'backup' | 'schema' | 'migration'>('backup');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  /**
   * État réel de la base de données, lu auprès du serveur. Aucune valeur par
   * défaut : si le serveur ne répond pas, l'interface dit que l'état n'a pas pu
   * être vérifié au lieu d'afficher une connexion imaginaire.
   */
  const [health, setHealth] = useState<{
    status: string;
    database: { connected: boolean; driver: string; version: string | null; appRoleAssumed: boolean };
    versions: { engine: string; methodology: string };
  } | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchHealth()
      .then((result) => {
        if (!cancelled) {
          setHealth(result);
          setHealthError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setHealth(null);
          setHealthError(error instanceof ApiError ? error.message : "L'état de la base n'a pas pu être vérifié.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleExport = () => {
    if (!isLocalDemo) {
      setFeedback({
        type: 'error',
        msg: 'Export local bloqué : ces données appartiennent au serveur PostgreSQL, pas à ce navigateur.',
      });
      return;
    }
    StorageService.exportFullBackup(projects, offers, suppliers, benchmarks, auditLogs);
    setFeedback({
      type: 'success',
      msg: 'Sauvegarde locale de démonstration exportée ; elle ne constitue pas une sauvegarde PostgreSQL.',
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isLocalDemo) {
      setFeedback({
        type: 'error',
        msg: 'Restauration locale bloquée : elle ne peut ni lire ni modifier les données du serveur.',
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
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
          msg: `Jeu local chargé dans ce navigateur : ${payload.projects.length} projet(s), ${payload.offers.length} offre(s). Aucune donnée serveur ni trace d'audit PostgreSQL n'a été restaurée.`,
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
    if (!isLocalDemo) {
      setFeedback({
        type: 'error',
        msg: 'Réinitialisation bloquée : les données du serveur ne peuvent pas être remplacées par le jeu de démonstration.',
      });
      return;
    }
    if (
      window.confirm(
        'Voulez-vous vraiment réinitialiser les données de démonstration locales de ce navigateur ? Les données du serveur ne seront pas modifiées.'
      )
    ) {
      onResetSeed();
      setFeedback({
        type: 'success',
        msg: 'Données réinitialisées au jeu de DÉMONSTRATION.',
      });
    }
  };

  const handleCopySqlPath = () => {
    navigator.clipboard.writeText(
      'Migrations de schéma versionnées dans src/db/migrations/. Commande de déploiement : npm run db:migrate avec DATABASE_URL configurée dans le gestionnaire de secrets. Cette commande n’exporte pas et ne restaure pas les données métier.'
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
                Données de DÉMONSTRATION locales (aucune session serveur) et état réel de la base côté serveur.
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
            Sauvegarde locale (démo uniquement)
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
            État de la base de données
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
            Migrations de schéma
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
        {activeTab === 'backup' && isLocalDemo && (
          <div className="space-y-3 text-xs">
            {/* Card 1: Export */}
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-white">Exporter le jeu local de démonstration</div>
                <div className="text-slate-400 text-[11px] mt-0.5">
                  Télécharge un JSON des données visibles dans ce navigateur. Ce fichier n'est ni un export PostgreSQL ni une preuve d'audit serveur.
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
                <div className="font-semibold text-white">Restaurer un jeu local</div>
                <div className="text-slate-400 text-[11px] mt-0.5">
                  Remplace les données locales de démonstration uniquement. Ne modifie pas la base serveur.
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
                  Rétablit le jeu de DÉMONSTRATION d'origine (50 VUL électriques vs thermiques) : ce sont des données
                  fictives, à ne pas confondre avec des données client.
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

        {activeTab === 'backup' && !isLocalDemo && (
          <div role="alert" className="rounded-xl border border-amber-700/70 bg-amber-950/40 p-4 text-xs leading-relaxed text-amber-100">
            <strong className="block text-sm">Sauvegarde locale désactivée pour une session serveur.</strong>
            <p className="mt-1">
              Exporter, restaurer ou réinitialiser depuis le navigateur agirait uniquement sur un cache local — jamais sur PostgreSQL — et pourrait afficher des données trompeuses. Ces actions sont donc bloquées.
            </p>
            <p className="mt-1 text-amber-200/80">
              La sauvegarde et la restauration des données serveur doivent être opérées par l’outil d’exploitation de la base.
            </p>
          </div>
        )}

        {/* Onglet 2 : état RÉEL de la base de données.
            L'onglet précédent affichait un schéma de tables fabriqué (colonnes qui
            n'existent pas), un nom d'hôte d'instance inventé et la mention
            « données Neon PostgreSQL connectées » alors qu'aucune connexion n'était
            vérifiée. Seul l'état renvoyé par /api/health est affiché ici. */}
        {activeTab === 'schema' && (
          <div className="space-y-3 text-xs">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <div className="font-bold text-white flex items-center gap-1.5">
                <Database className="w-4 h-4 text-emerald-400" />
                État de la base de données (vérifié auprès du serveur)
              </div>
              {health ? (
                <div className="text-[11px] text-slate-300 space-y-0.5 font-mono">
                  <div>
                    connectée : {health.database.connected ? 'oui' : 'non'} · moteur : {health.database.driver}
                  </div>
                  <div>version : {health.database.version ?? 'inconnue'}</div>
                  <div>rôle applicatif assumé (RLS actif) : {health.database.appRoleAssumed ? 'oui' : 'non'}</div>
                  <div>
                    moteur de calcul : {health.versions.engine} · méthodologie : {health.versions.methodology}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-amber-300">
                  {healthError ?? 'État de la base non disponible : aucune session serveur active.'}
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] text-slate-400 leading-relaxed">
              Les données de production vivent dans PostgreSQL, sur le serveur. Elles ne sont ni sauvegardées ni
              restaurées depuis ce navigateur : une sauvegarde locale ne protégerait pas les données du serveur et
              donnerait une fausse assurance. Les sauvegardes et restaurations relèvent des outils d'exploitation
              PostgreSQL. L'onglet « Sauvegarde locale » ne concerne que les données de DÉMONSTRATION affichées sans
              session.
            </div>
          </div>
        )}

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
                  <div className="font-semibold text-emerald-300 text-xs">
                    {health?.database.connected ? 'Base de données connectée' : 'Base de données non vérifiée'}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {health ? `${health.database.driver} · ${health.database.version ?? 'version inconnue'}` : 'aucune session serveur'}
                  </div>
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 bg-slate-800 text-slate-200 border border-slate-700 rounded font-mono font-semibold">
                {health?.database.driver?.toUpperCase() ?? 'HORS LIGNE'}
              </span>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
              <div>
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  Où vivent réellement les données
                </span>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  Les tables sont créées par les migrations SQL du dépôt ; l'API en publie l'état via /api/health.
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

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] text-slate-300 leading-relaxed space-y-1.5">
              <div className="font-semibold text-white">Où vivent réellement les données</div>
              <p>
                Les dossiers, offres, postes de coût, émissions, risques, exécutions de décision, lots d'import et le
                journal d'audit sont stockés dans PostgreSQL, côté serveur, sous isolation par organisation (Row Level
                Security). L'interface ne détient qu'un cache d'affichage.
              </p>
              <p>
                Le schéma réel se lit dans le dépôt : <code className="font-mono text-slate-200">src/db/migrations/</code>
                . Chaque migration appliquée est enregistrée avec son empreinte SHA-256 ; une migration déjà appliquée et
                modifiée après coup empêche le démarrage, afin que deux environnements ne puissent pas diverger en
                silence.
              </p>
              <p className="text-slate-400">
                Aucune sauvegarde ni restauration des données de production n'est possible depuis le navigateur. Le
                runner de migrations du dépôt agit sur le schéma ; la sauvegarde et la restauration des données relèvent
                des outils d'exploitation PostgreSQL.
              </p>
            </div>
          </div>
        )}

        {/* Onglet 3 : migrations versionnées du schéma, pas un dump de données */}
        {activeTab === 'migration' && (
          <div className="space-y-3 text-xs max-h-[380px] overflow-y-auto pr-1">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-slate-300">
              <div className="mb-2 flex items-center gap-2 font-semibold text-white">
                <Terminal className="h-4 w-4 text-emerald-400" />
                Migrations versionnées de la base
              </div>
              <p>
                Les fichiers de schéma sont versionnés dans <code className="font-mono text-slate-100">src/db/migrations/</code>.
                Le runner <code className="font-mono text-slate-100">npm run db:migrate</code> applique les migrations
                manquantes, enregistre leur empreinte SHA-256 et exécute chacune dans une transaction.
              </p>
              <p className="mt-2">
                Pour une base persistante, exécutez la commande dans le pipeline d’exploitation après validation de la
                cible et de la sauvegarde, avec <code className="font-mono text-slate-100">DATABASE_URL</code> injectée
                par un gestionnaire de secrets. Ne collez jamais cette URL dans le navigateur ou dans un fichier commité.
              </p>
              <p className="mt-2 text-amber-200">
                Cette commande migre le schéma ; elle n’exporte, ne sauvegarde et ne restaure aucune donnée métier.
                Le dépôt ne fournit pas de dump serveur depuis cette interface.
              </p>
              <p className="mt-2 text-slate-400">
                Le mode <code className="font-mono">TRUETCO_USE_PGLITE=true</code> sert aux essais locaux éphémères :
                la base embarquée disparaît à la fermeture du processus et ne vaut pas migration d’une base persistante.
              </p>
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-slate-800 flex justify-between items-center text-xs">
          <span className="text-slate-500 text-[11px]">
            Le journal d'audit est tenu par le serveur, chaîné par empreinte et vérifiable via l'API. Aucune conformité
            réglementaire n'est revendiquée ici : elle dépend d'un audit externe.
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
