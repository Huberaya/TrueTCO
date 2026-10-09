/**
 * TrueTCO - Moteur d'Arbitrage Économique & Coût Complet ESG
 * Application SaaS B2B d'Aide à la Décision Achats
 */

import React, { Suspense, lazy, useState, useEffect } from 'react';
import {
  SEED_PROJECTS,
  SEED_OFFERS,
  SEED_SUPPLIERS,
  SEED_BENCHMARKS,
  SEED_AUDIT_LOGS,
} from './data/seedData';
import { Project, SupplierOffer, Supplier, ExternalityReferenceBenchmark, AuditLogEntry, UserRole } from './types/domain';
import { Header } from './components/Header';
import { Sidebar, type NavView } from './components/Sidebar';
import { NewProjectModal } from './components/NewProjectModal';
import { ImportOfferModal } from './components/ImportOfferModal';
import { AutomatedTestsModal } from './components/AutomatedTestsModal';
import { DataBackupModal } from './components/DataBackupModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { StorageService, TrueTCOBackupPayload } from './services/storageService';
import {
  ApiError,
  DecisionRunResult,
  fetchLatestDecisionRun,
  runDecisionOnServer,
  createOfferOnServer,
  createProjectOnServer,
  createSupplierOnServer,
  fetchAuditLogsFromServer,
  fetchOffersFromServer,
  fetchProjectsFromServer,
  fetchSuppliersFromServer,
  updateProjectOnServer,
} from './services/serverData';
import { useAuth } from './context/AuthContext';
import { useTenant } from './context/TenantContext';
import { EnterpriseLoginModal } from './components/EnterpriseLoginModal';
import { NewTenantModal } from './components/NewTenantModal';

// Les écrans de navigation ne sont chargés qu'à leur première ouverture.
// En particulier, les vues qui exportent un classeur n'embarquent pas le moteur
// XLSX dans le paquet critique de démarrage.
const DashboardView = lazy(() => import('./components/DashboardView').then((module) => ({ default: module.DashboardView })));
const DecisionView = lazy(() => import('./components/DecisionView').then((module) => ({ default: module.DecisionView })));
const ImportCenterView = lazy(() => import('./components/ImportCenterView').then((module) => ({ default: module.ImportCenterView })));
const Chantier1View = lazy(() => import('./components/Chantier1View').then((module) => ({ default: module.Chantier1View })));
const ComparatorView = lazy(() => import('./components/ComparatorView').then((module) => ({ default: module.ComparatorView })));
const MulticriteriaView = lazy(() => import('./components/MulticriteriaView').then((module) => ({ default: module.MulticriteriaView })));
const BreakEvenView = lazy(() => import('./components/BreakEvenView').then((module) => ({ default: module.BreakEvenView })));
const ScenarioView = lazy(() => import('./components/ScenarioView').then((module) => ({ default: module.ScenarioView })));
const SensitivityView = lazy(() => import('./components/SensitivityView').then((module) => ({ default: module.SensitivityView })));
const ProjectsView = lazy(() => import('./components/ProjectsView').then((module) => ({ default: module.ProjectsView })));
const SuppliersView = lazy(() => import('./components/SuppliersView').then((module) => ({ default: module.SuppliersView })));
const ExternalitiesAdminView = lazy(() => import('./components/ExternalitiesAdminView').then((module) => ({ default: module.ExternalitiesAdminView })));
const AuditLogView = lazy(() => import('./components/AuditLogView').then((module) => ({ default: module.AuditLogView })));
const ExecutiveReportView = lazy(() => import('./components/ExecutiveReportView').then((module) => ({ default: module.ExecutiveReportView })));
const ErpConnectorsView = lazy(() => import('./components/ErpConnectorsView').then((module) => ({ default: module.ErpConnectorsView })));
const AiDocumentParserView = lazy(() => import('./components/AiDocumentParserView').then((module) => ({ default: module.AiDocumentParserView })));
const DigitalSignatureView = lazy(() => import('./components/DigitalSignatureView').then((module) => ({ default: module.DigitalSignatureView })));
const CsrdTaxonomyView = lazy(() => import('./components/CsrdTaxonomyView').then((module) => ({ default: module.CsrdTaxonomyView })));

export default function App() {
  const { user, isLoginModalOpen, closeLoginModal, permissions, authWarning } = useAuth();
  const { currentTenant, isNewTenantModalOpen, closeNewTenantModal } = useTenant();
  const [projects, setProjects] = useState<Project[]>(() => StorageService.getProjects());
  const [currentProjectId, setCurrentProjectId] = useState<string>(() => {
    return StorageService.getCurrentProjectId() || StorageService.getProjects()[0]?.id || SEED_PROJECTS[0].id;
  });
  const [offers, setOffers] = useState<SupplierOffer[]>(() => StorageService.getOffers());
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => StorageService.getSuppliers());
  const [benchmarks, setBenchmarks] = useState<ExternalityReferenceBenchmark[]>(() => StorageService.getBenchmarks());
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => StorageService.getAuditLogs());

  /**
   * Source de vérité effective. « serveur » : les données affichées viennent de
   * PostgreSQL via l'API. « cache-local » : données de démonstration lues dans le
   * navigateur (aucune session serveur) — l'interface l'indique explicitement.
   */
  const [dataSource, setDataSource] = useState<'serveur' | 'cache-local' | 'chargement'>('chargement');
  const [serverError, setServerError] = useState<string | null>(null);
  const [latestDecisionRun, setLatestDecisionRun] = useState<DecisionRunResult | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionRefreshKey, setDecisionRefreshKey] = useState(0);
  const [decisionRunning, setDecisionRunning] = useState(false);

  // Le rôle affiché provient de la session serveur. Aucun sélecteur de rôle :
  // un changement de rôle doit être effectué par un administrateur, pas par
  // l'utilisateur lui-même.
  const activeRole: UserRole = (user?.role ?? 'lecteur') as UserRole;

  /**
   * Droits déclarés par le serveur. Ils servent UNIQUEMENT à ne pas proposer une
   * action qui sera refusée : la décision d'autoriser revient toujours à l'API,
   * qui vérifie le rôle enregistré en base.
   */
  const can = React.useCallback((permission: string) => permissions.includes(permission), [permissions]);
  const [currentView, setCurrentView] = useState<NavView>('dashboard');

  // Toutes les vues décisionnelles lisent le dernier résultat persisté. Un run
  // ancien reste visible dans l'historique, mais ne devient jamais un chiffre
  // présenté comme courant si ses entrées ont changé.
  useEffect(() => {
    if (!user || dataSource !== 'serveur' || !currentProjectId || !permissions.includes('decision:read')) {
      setLatestDecisionRun(null);
      setDecisionError(null);
      setDecisionLoading(false);
      return;
    }
    let cancelled = false;
    setLatestDecisionRun(null);
    setDecisionError(null);
    setDecisionLoading(true);
    void fetchLatestDecisionRun(currentProjectId)
      .then((run) => {
        if (!cancelled) setLatestDecisionRun(run);
      })
      .catch((caught) => {
        if (cancelled) return;
        setDecisionError(caught instanceof ApiError ? `${caught.message} (${caught.code})` : 'Le dernier calcul serveur est injoignable.');
      })
      .finally(() => {
        if (!cancelled) setDecisionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, dataSource, currentProjectId, permissions, decisionRefreshKey]);

  // Modals state
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isImportOfferOpen, setIsImportOfferOpen] = useState(false);
  const [isTestsModalOpen, setIsTestsModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);

  /**
   * Chargement depuis le serveur. Aucune donnée de démonstration n'est injectée
   * en silence : si aucune session n'est ouverte, l'application reste sur le jeu
   * de démonstration et l'affiche comme tel.
   */
  const loadFromServer = React.useCallback(async () => {
    if (!user) {
      setDataSource('cache-local');
      return;
    }
    try {
      const [serverProjects, serverSuppliers, serverLogs] = await Promise.all([
        fetchProjectsFromServer(user.organizationId, user.id, user.fullName),
        fetchSuppliersFromServer(user.organizationId),
        fetchAuditLogsFromServer(),
      ]);
      setProjects(serverProjects);
      setSuppliers(serverSuppliers);
      setAuditLogs(serverLogs);
      setCurrentProjectId((previous) => (serverProjects.some((p) => p.id === previous) ? previous : serverProjects[0]?.id ?? ''));
      setDataSource('serveur');
      setServerError(null);
    } catch (err) {
      const message =
        err instanceof ApiError ? `${err.message} (${err.code})` : 'Le serveur est injoignable : affichage des données locales.';
      console.warn('[TrueTCO] Chargement serveur impossible :', message);
      setServerError(message);
      setDataSource('cache-local');
    }
  }, [user]);

  useEffect(() => {
    void loadFromServer();
  }, [loadFromServer]);

  /**
   * Offres du dossier courant : elles sont lues depuis l'API, comme les dossiers.
   *
   * Elles étaient auparavant conservées dans le navigateur, avec un avertissement
   * à la création (« enregistrement serveur prévu en Phase 3 »). Cet avertissement
   * disparaît : ce qui est affiché est ce qui est enregistré, pour la session en
   * cours comme pour toutes les suivantes. Les offres de démonstration ne restent
   * affichées que lorsqu'aucune session n'est ouverte, et l'interface le dit déjà
   * (`dataSource === 'cache-local'`).
   */
  useEffect(() => {
    if (!user || dataSource !== 'serveur' || !currentProjectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const serverOffers = await fetchOffersFromServer(user.organizationId, user.id, user.fullName, currentProjectId);
        if (cancelled) return;
        setOffers((previous) => [
          // Les offres des autres dossiers déjà chargées sont conservées : changer
          // de dossier ne doit pas faire disparaître l'écran précédent.
          ...previous.filter((offer) => offer.projectId !== currentProjectId),
          ...serverOffers,
        ]);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof ApiError ? `${err.message} (${err.code})` : 'Les offres du dossier n’ont pas pu être chargées.';
        setServerError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, dataSource, currentProjectId]);

  // Sync state to local storage on changes
  useEffect(() => {
    StorageService.saveProjects(projects);
  }, [projects]);

  useEffect(() => {
    StorageService.saveOffers(offers);
  }, [offers]);

  useEffect(() => {
    StorageService.saveSuppliers(suppliers);
  }, [suppliers]);

  useEffect(() => {
    StorageService.saveBenchmarks(benchmarks);
  }, [benchmarks]);

  useEffect(() => {
    StorageService.saveAuditLogs(auditLogs);
  }, [auditLogs]);

  useEffect(() => {
    if (currentProjectId) StorageService.saveCurrentProjectId(currentProjectId);
  }, [currentProjectId]);

  // Active project and its associated offers
  const currentProject = projects.find((p) => p.id === currentProjectId) || projects[0];
  const currentOffers = offers.filter((o) => {
    if (!currentProject) return false;
    return (
      o.projectId === currentProject.id ||
      (currentProject.id === 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' && o.projectId === 'proj-vul-50') ||
      (currentProject.id === 'proj-vul-50' && o.projectId === 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
    );
  });
  const decisionRunIsStale = Boolean(
    latestDecisionRun?.freshness &&
      (latestDecisionRun.freshness.dataChangedSinceRun || latestDecisionRun.freshness.engineChangedSinceRun)
  );
  const storedCompleteness = latestDecisionRun?.dataCompleteness;
  const hasValidCompleteness = Boolean(
    storedCompleteness &&
      Number.isInteger(storedCompleteness.totalCostItems) &&
      storedCompleteness.totalCostItems >= 0 &&
      storedCompleteness.byQualityStatus &&
      Object.values(storedCompleteness.byQualityStatus).every((count) => Number.isInteger(count) && count >= 0)
  );
  const hasServerCalculationPayload = Boolean(
    latestDecisionRun?.calculationsByOfferId &&
      Object.keys(latestDecisionRun.calculationsByOfferId).length > 0 &&
      hasValidCompleteness
  );
  const decisionRunForViews =
    latestDecisionRun && !decisionRunIsStale && hasServerCalculationPayload ? latestDecisionRun : null;

  const runDecisionForCurrentProject = async () => {
    if (!currentProjectId || !can('decision:run')) return;
    setDecisionRunning(true);
    setDecisionError(null);
    try {
      const run = await runDecisionOnServer(currentProjectId);
      setLatestDecisionRun(run);
    } catch (caught) {
      setDecisionError(caught instanceof ApiError ? `${caught.message} (${caught.code})` : 'Le calcul serveur a échoué.');
    } finally {
      setDecisionRunning(false);
    }
  };

  // Handlers
  const handleSelectProject = (p: Project) => {
    setCurrentProjectId(p.id);
  };

  /**
   * Création d'un dossier. L'écriture est faite par le serveur, qui journalise
   * l'action dans le journal d'audit. En cas d'échec, l'état local n'est PAS
   * modifié : l'utilisateur voit l'erreur exacte.
   */
  const handleAddProject = async (newProject: Project) => {
    if (!user) {
      setServerError("Création impossible : aucune session serveur ouverte. Connectez-vous pour enregistrer un dossier.");
      return;
    }
    try {
      const created = await createProjectOnServer(newProject);
      setProjects((prev) => [created, ...prev]);
      setCurrentProjectId(created.id);
      await loadFromServer();
    } catch (err) {
      const message = err instanceof ApiError ? `${err.message} (${err.code})` : 'Erreur inattendue du serveur.';
      setServerError(message);
    }
  };

  /**
   * Enregistrement d'une offre et de ses postes de coût.
   *
   * L'écriture est faite par le serveur, qui journalise l'action. En cas d'échec,
   * l'état affiché n'est PAS modifié : l'utilisateur voit l'erreur exacte plutôt
   * qu'une offre qui paraîtrait enregistrée. Après succès, les offres sont RELUES
   * depuis le serveur : l'écran affiche ce qui est en base, y compris les statuts
   * de qualité déduits par le serveur, et non ce que le navigateur croit avoir
   * envoyé.
   */
  const handleAddOffer = async (newOffer: SupplierOffer) => {
    if (!user || dataSource !== 'serveur') {
      setOffers((prev) => [...prev, newOffer]);
      setServerError(
        "Aucune session serveur ouverte : cette offre n'est conservée que dans le navigateur et sera perdue à la fermeture. Connectez-vous pour l'enregistrer."
      );
      return;
    }
    try {
      await createOfferOnServer(newOffer, currentProjectId);
      const refreshed = await fetchOffersFromServer(user.organizationId, user.id, user.fullName, currentProjectId);
      setOffers((prev) => [...prev.filter((offer) => offer.projectId !== currentProjectId), ...refreshed]);
      setDecisionRefreshKey((key) => key + 1);
      setServerError(null);
    } catch (err) {
      const message = err instanceof ApiError ? `${err.message} (${err.code})` : 'Erreur inattendue du serveur.';
      setServerError(message);
    }
  };

  const handleUpdateProject = async (updated: Project) => {
    if (dataSource !== 'serveur') {
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      return;
    }
    try {
      const saved = await updateProjectOnServer(updated);
      setProjects((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      setDecisionRefreshKey((key) => key + 1);
    } catch (err) {
      const message = err instanceof ApiError ? `${err.message} (${err.code})` : 'Erreur inattendue du serveur.';
      setServerError(message);
    }
  };

  const handleDuplicateProject = (p: Project) => {
    const clone: Project = {
      ...p,
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0')}`,
      reference: `${p.reference}-COPIE`,
      name: `${p.name} (Copie)`,
      status: 'brouillon',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    handleAddProject(clone);
  };

  const handleAddSupplier = async (newSupplier: Supplier) => {
    if (!user) {
      setServerError("Création impossible : aucune session serveur ouverte.");
      return;
    }
    try {
      const created = await createSupplierOnServer(newSupplier, user.organizationId);
      setSuppliers((prev) => [created, ...prev]);
      await loadFromServer();
    } catch (err) {
      const message = err instanceof ApiError ? `${err.message} (${err.code})` : 'Erreur inattendue du serveur.';
      setServerError(message);
    }
  };

  const handleUpdateSupplier = (updated: Supplier) => {
    // La modification d'un fournisseur reste locale tant que la route serveur de
    // mise à jour n'existe pas : aucun appel réseau fictif n'est effectué.
    setSuppliers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  };

  /**
   * Référentiel de facteurs : géré localement (les facteurs de plateforme ne
   * disposent pas encore de route d'écriture serveur). Toute modification est
   * présentée à l'utilisateur comme une hypothèse, jamais comme une valeur
   * institutionnelle vérifiée.
   */
  const handleUpdateBenchmark = (updated: ExternalityReferenceBenchmark, _justification: string) => {
    setBenchmarks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
  };

  const handleAddBenchmark = (newBench: ExternalityReferenceBenchmark) => {
    setBenchmarks((prev) => [...prev, newBench]);
  };

  /**
   * Le journal d'audit est en écriture serveur uniquement : une entrée produite
   * par le navigateur n'aurait aucune valeur probante. Cette fonction ne fait
   * donc rien d'autre que prévenir l'utilisateur.
   */
  const handleAddAuditLog = (_entry: AuditLogEntry) => {
    setServerError(
      "Le journal d'audit est tenu par le serveur : les actions y sont enregistrées automatiquement avec l'identité de la session."
    );
  };

  const handleRestoreData = (payload: TrueTCOBackupPayload) => {
    setProjects(payload.projects);
    setOffers(payload.offers);
    setSuppliers(payload.suppliers);
    setBenchmarks(payload.benchmarks);
    setAuditLogs(payload.auditLogs);
    if (payload.projects.length > 0) {
      setCurrentProjectId(payload.projects[0].id);
    }
  };

  const handleResetSeed = () => {
    StorageService.resetToSeed();
    setProjects(SEED_PROJECTS);
    setOffers(SEED_OFFERS);
    setSuppliers(SEED_SUPPLIERS);
    setBenchmarks(SEED_BENCHMARKS);
    setAuditLogs(SEED_AUDIT_LOGS);
    setCurrentProjectId(SEED_PROJECTS[0].id);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Bar Header */}
      <Header
        currentProject={currentProject}
        projects={projects}
        onSelectProject={handleSelectProject}
        activeRole={activeRole}
        onOpenNewProject={() => setIsNewProjectOpen(true)}
        onOpenTestsModal={() => setIsTestsModalOpen(true)}
        onOpenReportModal={() => setCurrentView('report')}
        onOpenBackupModal={() => setIsBackupModalOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <Sidebar
          currentView={currentView}
          onNavigate={setCurrentView}
          pendingApprovalsCount={1}
        />

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {dataSource === 'cache-local' && (
            <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <strong>Données locales de démonstration.</strong> Aucune session serveur n’est ouverte : les dossiers,
              fournisseurs et journaux affichés proviennent du jeu de démonstration du navigateur et ne sont pas
              enregistrés dans la base PostgreSQL.
              {serverError && <span className="block mt-1 text-amber-300/90">Détail : {serverError}</span>}
            </div>
          )}
          {dataSource === 'serveur' && serverError && (
            <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {serverError}
            </div>
          )}
          {dataSource === 'serveur' && (
            <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-200">
              Données servies par PostgreSQL (session authentifiée) : dossiers, offres, postes de coût, décisions,
              simulations et journal d’audit.
            </div>
          )}
          {authWarning && (
            <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              <strong>Avertissement du serveur sur cette session :</strong> {authWarning}
            </div>
          )}
          {dataSource === 'serveur' && ['chantier1', 'dashboard', 'comparator', 'multicriteria', 'breakeven', 'scenarios', 'sensitivity', 'decision', 'report'].includes(currentView) && (
            <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${decisionRunForViews ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-100' : 'border-amber-700/50 bg-amber-950/30 text-amber-100'}`} role="status">
              <div className="min-w-0 flex-1">
                {decisionLoading ? (
                  <span>Chargement du dernier calcul enregistré par le serveur…</span>
                ) : decisionError ? (
                  <span>{decisionError}</span>
                ) : decisionRunForViews ? (
                  <span>Résultats du serveur · moteur {decisionRunForViews.engineVersion} · méthodologie {decisionRunForViews.methodologyVersion} · révision {decisionRunForViews.inputVersion} · {new Date(decisionRunForViews.createdAt).toLocaleString('fr-FR')}</span>
                ) : decisionRunIsStale ? (
                  <span>Le dernier calcul enregistré ne correspond plus aux données actuelles ou à la version du moteur. Ses montants sont masqués jusqu'à un nouveau calcul.{latestDecisionRun?.freshness?.explanation ? ` ${latestDecisionRun.freshness.explanation}` : ''}</span>
                ) : latestDecisionRun && !hasServerCalculationPayload ? (
                  <span>Un ancien calcul est enregistré, mais il ne contient pas les sorties détaillées requises par ces écrans : relancez-le.</span>
                ) : !can('decision:read') ? (
                  <span>Votre session ne possède pas la permission de lecture des décisions serveur.</span>
                ) : (
                  <span>Aucun calcul serveur enregistré pour ce dossier. Aucun résultat ne sera calculé dans le navigateur.</span>
                )}
              </div>
              {can('decision:run') && (
                <button
                  type="button"
                  onClick={() => void runDecisionForCurrentProject()}
                  disabled={decisionRunning || decisionLoading}
                  className="rounded-lg border border-emerald-600 bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {decisionRunning ? 'Calcul serveur en cours…' : decisionRunForViews || decisionRunIsStale ? 'Recalculer côté serveur' : 'Calculer côté serveur'}
                </button>
              )}
            </div>
          )}
          <Suspense fallback={<div role="status" className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">Chargement de la vue…</div>}>
          {currentView === 'chantier1' && (
            <Chantier1View
              project={currentProject}
              offers={currentOffers}
              decisionRun={decisionRunForViews}
            />
          )}

          {currentView === 'dashboard' && (
            <DashboardView
              project={currentProject}
              projects={projects}
              offers={currentOffers}
              decisionRun={decisionRunForViews}
              onNavigate={setCurrentView}
              onSelectProject={handleSelectProject}
            />
          )}

          {currentView === 'comparator' && (
            <ComparatorView
              project={currentProject}
              offers={currentOffers}
              decisionRun={decisionRunForViews}
              auditLogs={auditLogs}
              onOpenImportModal={() => setIsImportOfferOpen(true)}
              onNavigate={setCurrentView}
            />
          )}

          {currentView === 'multicriteria' && (
            <MulticriteriaView
              decisionRun={decisionRunForViews}
              currency={currentProject?.currency ?? 'EUR'}
            />
          )}

          {currentView === 'breakeven' && (
            <BreakEvenView
              currency={currentProject?.currency ?? 'EUR'}
              decisionRun={decisionRunForViews}
            />
          )}

          {currentView === 'scenarios' && (
            <ScenarioView
              decisionRun={decisionRunForViews}
              currency={currentProject?.currency ?? 'EUR'}
            />
          )}

          {currentView === 'sensitivity' && (
            <SensitivityView
              decisionRun={decisionRunForViews}
              currency={currentProject?.currency ?? 'EUR'}
            />
          )}

          {currentView === 'projects' && (
            <ProjectsView
              projects={projects}
              currentProjectId={currentProjectId}
              offers={offers}
              onSelectProject={handleSelectProject}
              onOpenNewProject={() => setIsNewProjectOpen(true)}
              onNavigate={setCurrentView}
              onUpdateProject={handleUpdateProject}
              onDuplicateProject={handleDuplicateProject}
            />
          )}

          {currentView === 'decision' && (
            <DecisionView
              projectId={currentProject?.id ?? null}
              projectName={currentProject?.name ?? 'aucun dossier sélectionné'}
              currency={currentProject?.currency ?? 'EUR'}
              horizonYears={currentProject?.horizonYears ?? 5}
              discountRate={currentProject?.discountRate ?? 0}
              canRunDecision={can('decision:run')}
              initialRun={decisionRunForViews}
              onRunCompleted={(run) => {
                setLatestDecisionRun(run);
                setDecisionError(null);
              }}
            />
          )}

          {currentView === 'import_center' && (
            <ImportCenterView
              projectId={currentProject?.id ?? null}
              projectName={currentProject?.name ?? 'aucun dossier sélectionné'}
              projectCurrency={currentProject?.currency ?? 'EUR'}
              canImport={can('import:write')}
              onImported={() => {
                setDecisionRefreshKey((key) => key + 1);
                void loadFromServer();
              }}
            />
          )}

          {currentView === 'suppliers' && (
            <SuppliersView
              suppliers={suppliers}
              onAddSupplier={handleAddSupplier}
              onUpdateSupplier={handleUpdateSupplier}
            />
          )}

          {currentView === 'externalities' && (
            <ExternalitiesAdminView
              benchmarks={benchmarks}
              onUpdateBenchmark={handleUpdateBenchmark}
              onAddBenchmark={handleAddBenchmark}
            />
          )}

          {currentView === 'audit' && (
            <AuditLogView
              logs={auditLogs}
              onAddLog={handleAddAuditLog}
            />
          )}

          {currentView === 'report' && (
            <ExecutiveReportView
              project={currentProject}
              offers={currentOffers}
              decisionRun={decisionRunForViews}
              suppliers={suppliers}
              auditLogs={auditLogs}
              onBack={() => setCurrentView('comparator')}
              onUpdateProject={handleUpdateProject}
            />
          )}

          {currentView === 'erp_connectors' && (
            <ErpConnectorsView
              project={currentProject}
              offers={currentOffers}
              onAddOffer={handleAddOffer}
            />
          )}

          {currentView === 'ai_parser' && (
            <AiDocumentParserView
              project={currentProject}
              offers={currentOffers}
              onAddOffer={handleAddOffer}
              onNavigateToComparator={() => setCurrentView('comparator')}
            />
          )}

          {currentView === 'approvals' && (
            <DigitalSignatureView
              project={currentProject}
              permissions={permissions}
              /*
               * Mise à jour d'AFFICHAGE uniquement : l'écriture d'approbation a
               * déjà été faite et journalisée par le serveur, qui a renvoyé l'état
               * enregistré. Repasser par un enregistrement complet du dossier
               * enverrait le statut d'affichage arrondi et risquerait d'annuler
               * l'étape serveur qui vient d'être validée.
               */
              onProjectUpdated={(updated) =>
                setProjects((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
              }
            />
          )}

          {currentView === 'csrd_taxonomy' && (
            <CsrdTaxonomyView
              projects={projects}
              offers={offers}
            />
          )}
          </Suspense>
        </main>
      </div>

      {/* Modals */}
      <NewProjectModal
        isOpen={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onAddProject={handleAddProject}
      />

      <ImportOfferModal
        isOpen={isImportOfferOpen}
        onClose={() => setIsImportOfferOpen(false)}
        project={currentProject}
        suppliers={suppliers}
        onAddOffer={handleAddOffer}
      />

      <AutomatedTestsModal
        isOpen={isTestsModalOpen}
        onClose={() => setIsTestsModalOpen(false)}
      />

      <DataBackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        projects={projects}
        offers={offers}
        suppliers={suppliers}
        benchmarks={benchmarks}
        auditLogs={auditLogs}
        onRestoreData={handleRestoreData}
        onResetSeed={handleResetSeed}
      />

      {/* Enterprise SSO Login & IdP Modal */}
      <EnterpriseLoginModal
        isOpen={isLoginModalOpen}
        onClose={closeLoginModal}
      />

      {/* New Enterprise Tenant Modal */}
      <NewTenantModal
        isOpen={isNewTenantModalOpen}
        onClose={closeNewTenantModal}
      />

      {/* Network & Offline Status Toast */}
      <OfflineIndicator />
    </div>
  );
}
