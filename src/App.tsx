/**
 * TrueTCO - Moteur d'Arbitrage Économique & Coût Complet ESG
 * Application SaaS B2B d'Aide à la Décision Achats
 */

import React, { useState, useEffect, useCallback } from 'react';
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
import { DataBackupModal } from './components/DataBackupModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { StorageService, TrueTCOBackupPayload } from './services/storageService';
import { NeonService } from './services/neonService';
import { setActiveTenant } from './services/apiClient';
import { useAuth } from './context/AuthContext';
import { useTenant } from './context/TenantContext';
import { EnterpriseLoginModal } from './components/EnterpriseLoginModal';
import { NewTenantModal } from './components/NewTenantModal';
import { AiDocumentParserView } from './components/AiDocumentParserView';

type Collection = 'projects' | 'suppliers' | 'benchmarks' | 'audit' | 'offers';
const ALL_COLLECTIONS: Collection[] = ['projects', 'suppliers', 'benchmarks', 'audit', 'offers'];
/** Vues exploitables sans projet sélectionné. */
const VIEWS_WITHOUT_PROJECT: NavView[] = ['projects', 'suppliers', 'externalities', 'audit'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const newId = () => crypto.randomUUID();

export default function App() {
  const { user, isDemo, isLoginModalOpen, closeLoginModal } = useAuth();
  const { currentTenant, isNewTenantModalOpen, closeNewTenantModal } = useTenant();
  const connected = !isDemo;

  /**
   * MODE CONNECTÉ : le serveur est l'unique source de vérité. État initial VIDE, jamais de données de
   * démonstration, jamais de localStorage métier (poste partagé).
   * MODE DÉMO : données fictives locales, signalées par un bandeau permanent, sans aucun appel serveur.
   */
  const [projects, setProjects] = useState<Project[]>(() => (connected ? [] : StorageService.getProjects()));
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(() =>
    connected ? null : StorageService.getCurrentProjectId() || StorageService.getProjects()[0]?.id || SEED_PROJECTS[0].id
  );
  const [offers, setOffers] = useState<SupplierOffer[]>(() => (connected ? [] : StorageService.getOffers()));
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => (connected ? [] : StorageService.getSuppliers()));
  const [benchmarks, setBenchmarks] = useState<ExternalityReferenceBenchmark[]>(() => (connected ? [] : StorageService.getBenchmarks()));
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => (connected ? [] : StorageService.getAuditLogs()));
  const [syncStatus, setSyncStatus] = useState<'demo' | 'syncing' | 'synced' | 'error'>(connected ? 'syncing' : 'demo');
  const [notice, setNotice] = useState<string | null>(null);

  const [activeRole, setActiveRole] = useState<UserRole>(() => user?.role || 'directeur_achats');
  const [currentView, setCurrentView] = useState<NavView>('dashboard');

  // En mode connecté le rôle est celui du serveur ; en démo il est modifiable localement (aperçu des vues).
  useEffect(() => {
    if (user?.role) setActiveRole(user.role);
  }, [user?.role]);

  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isImportOfferOpen, setIsImportOfferOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);

  // ───────── Mode connecté : chargement depuis le serveur (REMPLACE l'état, y compris par du vide) ─────────
  useEffect(() => {
    if (connected) StorageService.clearBusinessData();
  }, [connected]);

  const refresh = useCallback(
    async (which: Collection[] = ALL_COLLECTIONS) => {
      if (!connected) return;
      setSyncStatus('syncing');
      try {
        const tid = currentTenant.id;
        const jobs: Promise<void>[] = [];
        if (which.includes('projects'))
          jobs.push(NeonService.fetchProjects(tid).then((r) => {
            setProjects(r);
            setCurrentProjectId((cur) => (cur && r.some((p) => p.id === cur) ? cur : r[0]?.id ?? null));
          }));
        if (which.includes('suppliers')) jobs.push(NeonService.fetchSuppliers(tid).then(setSuppliers));
        if (which.includes('benchmarks')) jobs.push(NeonService.fetchBenchmarks(tid).then(setBenchmarks));
        if (which.includes('audit')) jobs.push(NeonService.fetchAuditLogs(tid).then(setAuditLogs));
        if (which.includes('offers')) jobs.push(NeonService.fetchOffers(tid).then(setOffers));
        await Promise.all(jobs);
        setSyncStatus('synced');
      } catch (err) {
        setSyncStatus('error');
        setNotice(`Chargement impossible : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
      }
    },
    [connected, currentTenant.id]
  );

  // Au montage et à chaque changement d'organisation : on vide d'abord (aucun résidu de l'organisation précédente).
  useEffect(() => {
    if (!connected) return;
    setActiveTenant(currentTenant.id);
    setProjects([]); setOffers([]); setSuppliers([]); setBenchmarks([]); setAuditLogs([]); setCurrentProjectId(null);
    void refresh();
  }, [connected, currentTenant.id, refresh]);

  /**
   * Écriture serveur puis relecture : l'écran reflète TOUJOURS l'état réellement enregistré.
   * En cas d'échec, la modification est annulée à l'écran et l'erreur est affichée (jamais silencieuse).
   */
  const mutate = async (action: () => Promise<unknown>, collections: Collection[]) => {
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setNotice(`Enregistrement refusé : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    } finally {
      await refresh(collections);
    }
  };

  // ───────── Mode démo : persistance locale uniquement ─────────
  useEffect(() => { if (!connected) StorageService.saveProjects(projects); }, [connected, projects]);
  useEffect(() => { if (!connected) StorageService.saveOffers(offers); }, [connected, offers]);
  useEffect(() => { if (!connected) StorageService.saveSuppliers(suppliers); }, [connected, suppliers]);
  useEffect(() => { if (!connected) StorageService.saveBenchmarks(benchmarks); }, [connected, benchmarks]);
  useEffect(() => { if (!connected) StorageService.saveAuditLogs(auditLogs); }, [connected, auditLogs]);
  useEffect(() => { if (!connected && currentProjectId) StorageService.saveCurrentProjectId(currentProjectId); }, [connected, currentProjectId]);

  const currentProject: Project | undefined = projects.find((p) => p.id === currentProjectId) || projects[0];
  const currentOffers = offers.filter((o) => !!currentProject && o.projectId === currentProject.id);

  // Journal local (démo uniquement). En mode connecté, le serveur journalise : auteur, rôle, date.
  const demoLog = (entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'userId' | 'userName' | 'userRole'>) => {
    if (connected) return;
    setAuditLogs((prev) => [{
      ...entry, id: newId(), timestamp: new Date().toISOString(), userId: user?.id || 'demo-user',
      userName: user?.fullName || 'Profil de démonstration', userRole: activeRole,
    }, ...prev]);
  };

  // ───────── Handlers ─────────
  const handleSelectProject = (p: Project) => setCurrentProjectId(p.id);

  const handleAddProject = (input: Project) => {
    const project = connected && !UUID_RE.test(input.id) ? { ...input, id: newId() } : input;
    if (connected) {
      void mutate(() => NeonService.saveProject(project), ['projects', 'audit']).then(() => setCurrentProjectId(project.id));
      return;
    }
    setProjects((prev) => [project, ...prev]);
    setCurrentProjectId(project.id);
    demoLog({ projectId: project.id, entityName: "Projet d'Achat", fieldChanged: 'Création de projet', oldValue: 'N/A', newValue: project.name, justification: 'Création locale (démonstration).' });
  };

  const handleAddOffer = (input: SupplierOffer) => {
    if (!currentProject) return;
    const offer = connected && !UUID_RE.test(input.id) ? { ...input, id: newId() } : input;
    if (connected) {
      void mutate(() => NeonService.saveOffer(offer), ['offers', 'audit']);
      return;
    }
    setOffers((prev) => [...prev, offer]);
    demoLog({ projectId: currentProject.id, offerId: offer.id, entityName: `Offre ${offer.supplierName}`, fieldChanged: "Importation d'offre", oldValue: '0 €', newValue: `${offer.apparentTotal.toLocaleString('fr-FR')} €`, justification: 'Ajout local (démonstration).' });
  };

  const handleUpdateProject = (updated: Project) => {
    if (connected) { void mutate(() => NeonService.saveProject(updated), ['projects', 'audit']); return; }
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleDuplicateProject = (p: Project) => {
    const now = new Date().toISOString();
    handleAddProject({ ...p, id: newId(), reference: `${p.reference}-COPIE`, name: `${p.name} (Copie)`, status: 'brouillon', createdAt: now, updatedAt: now });
  };

  const handleAddSupplier = (input: Supplier) => {
    const supplier = connected && !UUID_RE.test(input.id) ? { ...input, id: newId() } : input;
    if (connected) { void mutate(() => NeonService.saveSupplier(supplier), ['suppliers', 'audit']); return; }
    setSuppliers((prev) => [supplier, ...prev]);
    demoLog({ entityName: `Fournisseur ${supplier.name}`, fieldChanged: 'Référencement fournisseur', oldValue: 'N/A', newValue: `${supplier.name} (${supplier.country})`, justification: 'Ajout local (démonstration).' });
  };

  const handleUpdateSupplier = (updated: Supplier) => {
    if (connected) { void mutate(() => NeonService.saveSupplier(updated), ['suppliers', 'audit']); return; }
    setSuppliers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleUpdateBenchmark = (updated: ExternalityReferenceBenchmark, justification: string) => {
    if (connected) {
      void mutate(async () => {
        await NeonService.saveBenchmark(updated);
        // La justification saisie est consignée dans le journal ; l'auteur et la date sont ceux du serveur.
        const old = benchmarks.find((b) => b.id === updated.id);
        await NeonService.saveAuditNote({
          id: '', timestamp: '', userId: '', userName: '', userRole: activeRole, projectId: currentProject?.id,
          entityName: updated.name, fieldChanged: 'Valeur de référence',
          oldValue: old ? `${old.value} ${old.unit}` : 'N/A', newValue: `${updated.value} ${updated.unit}`,
          justification: justification || 'Aucune justification saisie',
        } as AuditLogEntry);
      }, ['benchmarks', 'audit']);
      return;
    }
    const old = benchmarks.find((b) => b.id === updated.id);
    setBenchmarks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    if (old) demoLog({ projectId: currentProject?.id, entityName: updated.name, fieldChanged: 'Valeur de référence', oldValue: `${old.value} ${old.unit}`, newValue: `${updated.value} ${updated.unit}`, justification: justification || 'Aucune justification saisie' });
  };

  const handleAddBenchmark = (input: ExternalityReferenceBenchmark) => {
    const bench = connected && !UUID_RE.test(input.id) ? { ...input, id: newId() } : input;
    if (connected) { void mutate(() => NeonService.saveBenchmark(bench), ['benchmarks', 'audit']); return; }
    setBenchmarks((prev) => [...prev, bench]);
    demoLog({ entityName: bench.name, fieldChanged: 'Création facteur référentiel', oldValue: 'N/A', newValue: `${bench.value} ${bench.unit}`, justification: `Source indiquée : ${bench.source}` });
  };

  /** Justification saisie par l'utilisateur. En mode connecté : contenu déclaré, identité/date imposées par le serveur. */
  const handleAddAuditLog = (entry: AuditLogEntry) => {
    if (connected) { void mutate(() => NeonService.saveAuditNote(entry), ['audit']); return; }
    setAuditLogs((prev) => [entry, ...prev]);
  };

  /** Restauration / réinitialisation : démonstration uniquement (en mode connecté le serveur fait foi). */
  const handleRestoreData = (payload: TrueTCOBackupPayload) => {
    if (connected) return;
    setProjects(payload.projects); setOffers(payload.offers); setSuppliers(payload.suppliers);
    setBenchmarks(payload.benchmarks); setAuditLogs(payload.auditLogs);
    if (payload.projects.length > 0) setCurrentProjectId(payload.projects[0].id);
  };

  const handleResetSeed = () => {
    if (connected) return;
    StorageService.resetToSeed();
    setProjects(SEED_PROJECTS); setOffers(SEED_OFFERS); setSuppliers(SEED_SUPPLIERS);
    setBenchmarks(SEED_BENCHMARKS); setAuditLogs(SEED_AUDIT_LOGS); setCurrentProjectId(SEED_PROJECTS[0].id);
  };

  const needsProject = !VIEWS_WITHOUT_PROJECT.includes(currentView);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Bar Header */}
      <Header
        currentProject={currentProject}
        projects={projects}
        onSelectProject={handleSelectProject}
        activeRole={activeRole}
        onChangeRole={setActiveRole}
        onOpenNewProject={() => setIsNewProjectOpen(true)}
        syncStatus={syncStatus}
        onOpenReportModal={() => setCurrentView('report')}
        onOpenBackupModal={() => setIsBackupModalOpen(true)}
      />

      {isDemo && (
        <div role="status" className="bg-amber-950/80 border-b border-amber-800/60 text-amber-200 text-xs px-4 py-1.5 text-center no-print">
          <strong>Mode démonstration</strong> — données, valeurs et sources <strong>fictives et illustratives</strong>, stockées uniquement dans ce navigateur. Ne pas utiliser pour une décision réelle.
        </div>
      )}
      {notice && (
        <div role="alert" className="bg-rose-950/80 border-b border-rose-800/60 text-rose-200 text-xs px-4 py-1.5 flex items-center justify-between no-print">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="underline ml-4">Fermer</button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <Sidebar
          currentView={currentView}
          onNavigate={setCurrentView}
        />

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {needsProject && !currentProject && (
            <div className="max-w-lg mx-auto mt-16 text-center space-y-4">
              <h2 className="text-lg font-bold text-white">{syncStatus === 'syncing' ? 'Chargement…' : 'Aucun projet pour le moment'}</h2>
              {syncStatus !== 'syncing' && (
                <>
                  <p className="text-sm text-slate-400">Créez votre premier projet d'achat pour comparer des offres sur leur coût complet.</p>
                  <button onClick={() => setIsNewProjectOpen(true)} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white">
                    Créer un projet
                  </button>
                </>
              )}
            </div>
          )}
          {currentView === 'chantier1' && currentProject && (
            <Chantier1View
              project={currentProject}
              offers={currentOffers}
            />
          )}

          {currentView === 'dashboard' && currentProject && (
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

          {currentView === 'comparator' && currentProject && (
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

          {currentView === 'multicriteria' && currentProject && (
            <MulticriteriaView
              project={currentProject}
              offers={currentOffers}
              suppliers={suppliers}
              activeRole={activeRole}
              onLogAudit={handleAddAuditLog}
            />
          )}

          {currentView === 'breakeven' && currentProject && (
            <BreakEvenView
              project={currentProject}
              offers={currentOffers}
            />
          )}

          {currentView === 'scenarios' && currentProject && (
            <ScenarioView
              project={currentProject}
              offers={currentOffers}
            />
          )}

          {currentView === 'sensitivity' && currentProject && (
            <SensitivityView
              project={currentProject}
              offers={currentOffers}
            />
          )}

          {currentView === 'projects' && (
            <ProjectsView
              projects={projects}
              currentProjectId={currentProject?.id ?? ''}
              offers={offers}
              onSelectProject={handleSelectProject}
              onOpenNewProject={() => setIsNewProjectOpen(true)}
              onNavigate={setCurrentView}
              onUpdateProject={handleUpdateProject}
              onDuplicateProject={handleDuplicateProject}
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

          {currentView === 'report' && currentProject && (
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

          {currentView === 'ai_parser' && currentProject && (
            <AiDocumentParserView
              project={currentProject}
              offers={currentOffers}
              suppliers={suppliers}
              onAddOffer={handleAddOffer}
              onNavigateToSuppliers={() => setCurrentView('suppliers')}
              onNavigateToComparator={() => setCurrentView('comparator')}
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
        isDemo={isDemo}
      />

      {/* Session */}
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
