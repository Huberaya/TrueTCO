/**
 * TrueTCO - Moteur d'Arbitrage Économique & Coût Complet ESG
 * Application SaaS B2B d'Aide à la Décision Achats
 */

import React, { useState, useEffect } from 'react';
import {
  SEED_PROJECTS,
  SEED_OFFERS,
  SEED_SUPPLIERS,
  SEED_BENCHMARKS,
  SEED_AUDIT_LOGS,
} from './data/seedData';
import { Project, SupplierOffer, Supplier, ExternalityReferenceBenchmark, AuditLogEntry, UserRole } from './types/domain';
import { Header } from './components/Header';
import { Sidebar, NavView } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { DecisionView } from './components/DecisionView';
import { ImportCenterView } from './components/ImportCenterView';
import { Chantier1View } from './components/Chantier1View';
import { ComparatorView } from './components/ComparatorView';
import { MulticriteriaView } from './components/MulticriteriaView';
import { BreakEvenView } from './components/BreakEvenView';
import { ScenarioView } from './components/ScenarioView';
import { SensitivityView } from './components/SensitivityView';
import { ProjectsView } from './components/ProjectsView';
import { SuppliersView } from './components/SuppliersView';
import { ExternalitiesAdminView } from './components/ExternalitiesAdminView';
import { AuditLogView } from './components/AuditLogView';
import { ExecutiveReportView } from './components/ExecutiveReportView';
import { NewProjectModal } from './components/NewProjectModal';
import { ImportOfferModal } from './components/ImportOfferModal';
import { AutomatedTestsModal } from './components/AutomatedTestsModal';
import { DataBackupModal } from './components/DataBackupModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { StorageService, TrueTCOBackupPayload } from './services/storageService';
import {
  ApiError,
  createProjectOnServer,
  createSupplierOnServer,
  fetchAuditLogsFromServer,
  fetchProjectsFromServer,
  fetchSuppliersFromServer,
  updateProjectOnServer,
} from './services/serverData';
import { useAuth } from './context/AuthContext';
import { useTenant } from './context/TenantContext';
import { EnterpriseLoginModal } from './components/EnterpriseLoginModal';
import { NewTenantModal } from './components/NewTenantModal';
import { ErpConnectorsView } from './components/ErpConnectorsView';
import { AiDocumentParserView } from './components/AiDocumentParserView';
import { DigitalSignatureView } from './components/DigitalSignatureView';
import { CsrdTaxonomyView } from './components/CsrdTaxonomyView';

export default function App() {
  const { user, isLoginModalOpen, closeLoginModal, permissions } = useAuth();
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
  const [currentView, setCurrentView] = useState<NavView>('chantier1');

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
   * Les offres et leurs postes de coût : l'enregistrement serveur exige la
   * correspondance entre le modèle métier de l'interface et les tables
   * `supplier_offers` / `cost_items`. Cette correspondance est réalisée avec le
   * branchement du moteur de calcul (Phase 3) : d'ici là, l'offre reste locale et
   * l'interface l'indique. Aucune écriture partielle n'est envoyée au serveur.
   */
  const handleAddOffer = (newOffer: SupplierOffer) => {
    setOffers((prev) => [...prev, newOffer]);
    setServerError(
      "Cette offre est conservée localement : l'enregistrement serveur des offres et de leurs postes de coût sera branché avec le moteur de calcul (Phase 3). Aucune donnée n'a été écrite en base."
    );
  };

  const handleUpdateProject = async (updated: Project) => {
    if (dataSource !== 'serveur') {
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      return;
    }
    try {
      const saved = await updateProjectOnServer(updated);
      setProjects((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
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
              Données servies par PostgreSQL (session authentifiée). Les offres restent locales jusqu’au branchement du
              moteur de calcul (Phase 3).
            </div>
          )}
          {currentView === 'chantier1' && (
            <Chantier1View
              project={currentProject}
              offers={currentOffers}
            />
          )}

          {currentView === 'dashboard' && (
            <DashboardView
              project={currentProject}
              projects={projects}
              offers={currentOffers}
              activeRole={activeRole}
              onNavigate={setCurrentView}
              onSelectProject={handleSelectProject}
              onUpdateProject={handleUpdateProject}
            />
          )}

          {currentView === 'comparator' && (
            <ComparatorView
              project={currentProject}
              offers={currentOffers}
              suppliers={suppliers}
              auditLogs={auditLogs}
              benchmarks={benchmarks}
              onOpenImportModal={() => setIsImportOfferOpen(true)}
              onUpdateProject={handleUpdateProject}
              onNavigate={setCurrentView}
            />
          )}

          {currentView === 'multicriteria' && (
            <MulticriteriaView
              project={currentProject}
              offers={currentOffers}
              suppliers={suppliers}
              activeRole={activeRole}
              onLogAudit={(log) => setAuditLogs((prev) => [log, ...prev])}
            />
          )}

          {currentView === 'breakeven' && (
            <BreakEvenView
              project={currentProject}
              offers={currentOffers}
            />
          )}

          {currentView === 'scenarios' && (
            <ScenarioView
              project={currentProject}
              offers={currentOffers}
            />
          )}

          {currentView === 'sensitivity' && (
            <SensitivityView
              project={currentProject}
              offers={currentOffers}
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
              canRunDecision={can('decision:run')}
            />
          )}

          {currentView === 'import_center' && (
            <ImportCenterView
              projectId={currentProject?.id ?? null}
              projectName={currentProject?.name ?? 'aucun dossier sélectionné'}
              projectCurrency={currentProject?.currency ?? 'EUR'}
              canImport={can('import:write')}
              onImported={() => void loadFromServer()}
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
              suppliers={suppliers}
              auditLogs={auditLogs}
              benchmarks={benchmarks}
              onBack={() => setCurrentView('comparator')}
              onUpdateProject={handleUpdateProject}
              onAddAuditLog={handleAddAuditLog}
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

          {currentView === 'digital_signature' && (
            <DigitalSignatureView
              project={currentProject}
              offers={currentOffers}
            />
          )}

          {currentView === 'csrd_taxonomy' && (
            <CsrdTaxonomyView
              projects={projects}
              offers={offers}
            />
          )}
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
