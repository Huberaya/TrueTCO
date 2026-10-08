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
import { NeonService } from './services/neonService';
import { useAuth } from './context/AuthContext';
import { useTenant } from './context/TenantContext';
import { EnterpriseLoginModal } from './components/EnterpriseLoginModal';
import { NewTenantModal } from './components/NewTenantModal';
import { ErpConnectorsView } from './components/ErpConnectorsView';
import { AiDocumentParserView } from './components/AiDocumentParserView';
import { DigitalSignatureView } from './components/DigitalSignatureView';
import { CsrdTaxonomyView } from './components/CsrdTaxonomyView';

export default function App() {
  const { user, isLoginModalOpen, closeLoginModal } = useAuth();
  const { currentTenant, isNewTenantModalOpen, closeNewTenantModal } = useTenant();
  const [projects, setProjects] = useState<Project[]>(() => StorageService.getProjects());
  const [currentProjectId, setCurrentProjectId] = useState<string>(() => {
    return StorageService.getCurrentProjectId() || StorageService.getProjects()[0]?.id || SEED_PROJECTS[0].id;
  });
  const [offers, setOffers] = useState<SupplierOffer[]>(() => StorageService.getOffers());
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => StorageService.getSuppliers());
  const [benchmarks, setBenchmarks] = useState<ExternalityReferenceBenchmark[]>(() => StorageService.getBenchmarks());
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => StorageService.getAuditLogs());

  // Le rôle affiché provient de la session serveur. Aucun sélecteur de rôle :
  // un changement de rôle doit être effectué par un administrateur, pas par
  // l'utilisateur lui-même.
  const activeRole: UserRole = (user?.role ?? 'lecteur') as UserRole;
  const [currentView, setCurrentView] = useState<NavView>('chantier1');

  // Modals state
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isImportOfferOpen, setIsImportOfferOpen] = useState(false);
  const [isTestsModalOpen, setIsTestsModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);

  // Load remote projects, audit logs, and benchmarks from Neon DB on mount if available
  useEffect(() => {
    NeonService.fetchProjects().then((remoteProjects) => {
      if (remoteProjects && remoteProjects.length > 0) {
        setProjects((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const newFromNeon = remoteProjects.filter((p) => !existingIds.has(p.id));
          if (newFromNeon.length > 0) {
            console.log(`[TrueTCO] Loaded ${newFromNeon.length} new project(s) from Neon database.`);
            return [...newFromNeon, ...prev];
          }
          return prev;
        });
      }
    });

    NeonService.fetchAuditLogs().then((remoteLogs) => {
      if (remoteLogs && remoteLogs.length > 0) {
        setAuditLogs((prev) => {
          const existingIds = new Set(prev.map((l) => l.id));
          const newFromNeon = remoteLogs.filter((l) => !existingIds.has(l.id));
          return newFromNeon.length > 0 ? [...newFromNeon, ...prev] : prev;
        });
      }
    });

    NeonService.fetchBenchmarks().then((remoteBenchmarks) => {
      if (remoteBenchmarks && remoteBenchmarks.length > 0) {
        setBenchmarks((prev) => {
          const existingNames = new Set(prev.map((b) => b.name));
          const newFromNeon = remoteBenchmarks.filter((b) => !existingNames.has(b.name));
          return newFromNeon.length > 0 ? [...newFromNeon, ...prev] : prev;
        });
      }
    });
  }, []);

  // Hermetic Multi-Tenancy: Reload tenant-scoped projects, suppliers, and audit logs on tenant switch
  useEffect(() => {
    let isMounted = true;

    NeonService.fetchProjects(currentTenant.id).then((remoteProjects) => {
      if (!isMounted) return;
      if (remoteProjects && remoteProjects.length > 0) {
        setProjects(remoteProjects);
        setCurrentProjectId(remoteProjects[0].id);
      }
    });

    NeonService.fetchSuppliers(currentTenant.id).then((remoteSuppliers) => {
      if (!isMounted) return;
      if (remoteSuppliers && remoteSuppliers.length > 0) {
        setSuppliers(remoteSuppliers);
      }
    });

    NeonService.fetchAuditLogs(currentTenant.id).then((remoteLogs) => {
      if (!isMounted) return;
      if (remoteLogs && remoteLogs.length > 0) {
        setAuditLogs(remoteLogs);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [currentTenant.id]);

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

  const handleAddProject = (newProject: Project) => {
    setProjects((prev) => [newProject, ...prev]);
    setCurrentProjectId(newProject.id);

    // Create corresponding audit log entry
    const log: AuditLogEntry = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: user?.id || 'session-inconnue',
      userName: user?.fullName || 'Utilisateur non authentifié',
      userRole: user?.role || activeRole,
      projectId: newProject.id,
      entityName: 'Projet d\'Achat',
      fieldChanged: 'Création de projet',
      oldValue: 'N/A',
      newValue: newProject.name,
      justification: 'Ouverture de consultation pour arbitrage TCO pluriannuel.',
    };
    setAuditLogs((prev) => [log, ...prev]);

    // Persist directly to Neon PostgreSQL in background
    NeonService.saveProject(newProject);
    NeonService.saveAuditLog(log);
  };

  const handleAddOffer = (newOffer: SupplierOffer) => {
    setOffers((prev) => [...prev, newOffer]);

    // Create corresponding audit log entry
    const log: AuditLogEntry = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: user?.id || 'session-inconnue',
      userName: user?.fullName || 'Utilisateur non authentifié',
      userRole: user?.role || activeRole,
      projectId: currentProject.id,
      offerId: newOffer.id,
      entityName: `Offre ${newOffer.supplierName}`,
      fieldChanged: 'Importation d\'offre',
      oldValue: '0 €',
      newValue: `${newOffer.apparentTotal.toLocaleString('fr-FR')} €`,
      justification: 'Intégration d\'une proposition fournisseur pour normalisation TCO.',
    };
    setAuditLogs((prev) => [log, ...prev]);

    // Persist directly to Neon PostgreSQL
    NeonService.saveOffer(newOffer);
    NeonService.saveAuditLog(log);
  };

  const handleUpdateProject = (updated: Project) => {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    NeonService.saveProject(updated);
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

  const handleAddSupplier = (newSupplier: Supplier) => {
    setSuppliers((prev) => [newSupplier, ...prev]);

    const log: AuditLogEntry = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: user?.id || 'session-inconnue',
      userName: user?.fullName || 'Utilisateur non authentifié',
      userRole: user?.role || activeRole,
      entityName: `Fournisseur ${newSupplier.name}`,
      fieldChanged: 'Référencement & Qualification Tiers',
      oldValue: 'N/A',
      newValue: `${newSupplier.name} (${newSupplier.country})`,
      justification: `Enregistrement du fournisseur avec un score qualité données de ${newSupplier.dataQualityScore}%.`,
    };
    setAuditLogs((prev) => [log, ...prev]);
    NeonService.saveAuditLog(log);
    NeonService.saveSupplier(newSupplier);
  };

  const handleUpdateSupplier = (updated: Supplier) => {
    setSuppliers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    NeonService.saveSupplier(updated);
  };

  const handleUpdateBenchmark = (updated: ExternalityReferenceBenchmark, justification: string) => {
    const old = benchmarks.find((b) => b.id === updated.id);
    setBenchmarks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    NeonService.saveBenchmark(updated);

    if (old) {
      const log: AuditLogEntry = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0')}`,
        timestamp: new Date().toISOString(),
        userId: user?.id || 'session-inconnue',
        userName: user?.fullName || 'Utilisateur non authentifié',
        userRole: user?.role || activeRole,
        projectId: currentProject.id,
        entityName: updated.name,
        fieldChanged: 'Valeur de référence pivot',
        oldValue: `${old.value} ${old.unit}`,
        newValue: `${updated.value} ${updated.unit}`,
        justification: justification || 'Mise à jour périodique du référentiel institutionnel.',
      };
      setAuditLogs((prev) => [log, ...prev]);
      NeonService.saveAuditLog(log);
    }
  };

  const handleAddBenchmark = (newBench: ExternalityReferenceBenchmark) => {
    setBenchmarks((prev) => [...prev, newBench]);
    NeonService.saveBenchmark(newBench);

    const log: AuditLogEntry = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0')}`,
      timestamp: new Date().toISOString(),
      userId: user?.id || 'session-inconnue',
      userName: user?.fullName || 'Utilisateur non authentifié',
      userRole: user?.role || activeRole,
      entityName: newBench.name,
      fieldChanged: 'Création facteur référentiel',
      oldValue: 'N/A',
      newValue: `${newBench.value} ${newBench.unit}`,
      justification: `Intégration d'un nouveau facteur institutionnel (${newBench.source}).`,
    };
    setAuditLogs((prev) => [log, ...prev]);
    NeonService.saveAuditLog(log);
  };

  const handleAddAuditLog = (entry: AuditLogEntry) => {
    setAuditLogs((prev) => [entry, ...prev]);
    NeonService.saveAuditLog(entry);
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
