import React, { useRef, useState } from 'react';
import {
  Sparkles,
  FileText,
  UploadCloud,
  CheckCircle2,
  FileCheck2,
  ArrowRight,
  Layers,
  Scale,
  ShieldAlert,
  Zap,
  Info,
  Check,
} from 'lucide-react';
import { Project, SupplierOffer, DocumentParseResult, DocumentCategory } from '../types/domain';
import { AiParserService, SAMPLE_DOCUMENTS, SampleDocumentItem } from '../services/aiParserService';

interface AiDocumentParserViewProps {
  project: Project;
  offers: SupplierOffer[];
  onAddOffer: (offer: SupplierOffer) => void;
  onNavigateToComparator?: () => void;
}

export const AiDocumentParserView: React.FC<AiDocumentParserViewProps> = ({
  project,
  offers,
  onAddOffer,
  onNavigateToComparator,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<DocumentCategory>('devis_fournisseur');
  const [inputContent, setInputContent] = useState<string>('');
  const [filename, setFilename] = useState<string>('');
  const [activeSampleId, setActiveSampleId] = useState<string>('');

  // Parsing execution state
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parseResult, setParseResult] = useState<DocumentParseResult | null>(null);
  const [injectedSuccess, setInjectedSuccess] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const parseRequestId = useRef(0);

  const invalidateCurrentParse = () => {
    parseRequestId.current += 1;
    setStatusMessage(null);
    setIsParsing(false);
    setParseResult(null);
    setInjectedSuccess(false);
  };

  // Active sub-tab
  const [activeSubTab, setActiveSubTab] = useState<'parser' | 'comparison' | 'spec'>('parser');

  const handleSelectSample = (sample: SampleDocumentItem) => {
    invalidateCurrentParse();
    setActiveSampleId(sample.id);
    setSelectedCategory(sample.category);
    setFilename(sample.title);
    setInputContent(sample.contentRaw);
    setParseResult(null);
    setInjectedSuccess(false);
    setStatusMessage(null);
  };

  const handleRunAiParsing = async () => {
    if (!inputContent.trim()) {
      setStatusMessage('Veuillez coller le contenu d’un devis ou choisir un échantillon.');
      return;
    }

    const requestId = ++parseRequestId.current;
    setIsParsing(true);
    setStatusMessage('Envoi non effectué tant que le service sécurisé de traitement documentaire n’est pas disponible...');
    setParseResult(null);
    setInjectedSuccess(false);

    try {
      const result = await AiParserService.parseDocument({
        filename,
        content: inputContent,
        category: selectedCategory,
      });
      if (requestId !== parseRequestId.current) return;
      setParseResult(result);
      setStatusMessage(null);
    } catch (err: any) {
      if (requestId !== parseRequestId.current) return;
      setParseResult(null);
      setStatusMessage(`Analyse indisponible : ${err?.message || 'Aucune donnée extraite.'}`);
    } finally {
      if (requestId === parseRequestId.current) setIsParsing(false);
    }
  };

  const handleInjectIntoProject = () => {
    if (!parseResult) return;
    const newOffer = AiParserService.convertToSupplierOffer(parseResult, project.id);
    onAddOffer(newOffer);
    setInjectedSuccess(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-purple-400 mb-1 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            Chantier 8 · Parser IA & OCR Multimodal de Devis & Fiches FDES / EPD
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Prototype documentaire — analyse désactivée
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Prototype de saisie documentaire. Le traitement externe est désactivé tant que les contrôles d’accès, de consentement et de protection des documents ne sont pas configurés.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-purple-950/80 border border-purple-800/80 text-purple-300 rounded-full text-xs font-mono font-medium">
            Projet Cible : {project.reference}
          </span>
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <button
          onClick={() => setActiveSubTab('parser')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeSubTab === 'parser'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Banc d'Extraction & Analyse IA
        </button>

        <button
          onClick={() => setActiveSubTab('spec')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeSubTab === 'spec'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <FileCheck2 className="w-3.5 h-3.5" />
          Spécification & Méthodologie ACV / INIES
        </button>
      </div>

      {activeSubTab === 'parser' && (
        <div className="space-y-6">
          {/* Sample Selectors */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Échantillons de démonstration (fictifs, non vérifiés) :</span>
              <span className="text-slate-500 text-[11px]">Exemples fictifs uniquement; aucune analyse ni extraction métier n’est disponible</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {SAMPLE_DOCUMENTS.map((sample) => {
                const isSelected = activeSampleId === sample.id;
                return (
                  <button
                    key={sample.id}
                    onClick={() => handleSelectSample(sample)}
                    className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'bg-purple-950/50 border-purple-500 shadow-md shadow-purple-950/40 ring-1 ring-purple-500/50'
                        : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${
                            sample.category === 'devis_fournisseur'
                              ? 'bg-sky-950 text-sky-400 border border-sky-800/80'
                              : 'bg-emerald-950 text-emerald-400 border border-emerald-800/80'
                          }`}
                        >
                          {sample.category === 'devis_fournisseur' ? 'Devis PDF' : 'FDES / EPD'}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">{sample.fileFormat}</span>
                      </div>
                      <div className="font-bold text-white text-xs line-clamp-2">{sample.title}</div>
                      <div className="text-[11px] text-slate-400 line-clamp-2">{sample.snippet}</div>
                    </div>

                    <div className="pt-2 mt-2 border-t border-slate-800/80 text-[10px] text-purple-400 font-medium flex items-center justify-between">
                      <span>{sample.supplierName}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-purple-400" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Work Area: Input on Left, Output on Right */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT COLUMN: Input Text / Upload */}
            <div className="lg:col-span-5 space-y-4">
              <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-white text-xs flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-purple-400" />
                    Texte de démonstration — analyse indisponible
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    {inputContent.length} caractères
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Nom du document</label>
                  <input
                    type="text"
                    value={filename}
                    onChange={(e) => {
                      setFilename(e.target.value);
                      setParseResult(null);
                      setInjectedSuccess(false);
                    }}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Catégorie de document</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        invalidateCurrentParse();
                        setSelectedCategory('devis_fournisseur');
                        setParseResult(null);
                        setInjectedSuccess(false);
                      }}
                      className={`py-1.5 px-2 rounded-lg text-xs font-medium border text-center transition-colors ${
                        selectedCategory === 'devis_fournisseur'
                          ? 'bg-purple-950 border-purple-500 text-purple-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Bordereau / Devis Prix
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        invalidateCurrentParse();
                        setSelectedCategory('fiche_fdes_epd');
                        setParseResult(null);
                        setInjectedSuccess(false);
                      }}
                      className={`py-1.5 px-2 rounded-lg text-xs font-medium border text-center transition-colors ${
                        selectedCategory === 'fiche_fdes_epd'
                          ? 'bg-purple-950 border-purple-500 text-purple-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Fiche FDES / EPD Carbone
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Contenu brut (Texte extrait ou flux OCR)
                  </label>
                  <textarea
                    rows={12}
                    value={inputContent}
                    onChange={(e) => {
                      invalidateCurrentParse();
                      setInputContent(e.target.value);
                      setParseResult(null);
                      setInjectedSuccess(false);
                    }}
                    className="w-full p-3 bg-slate-950 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 leading-relaxed focus:outline-none focus:border-purple-500 select-text"
                    placeholder="Collez ici le texte brut d’un devis ou d'une déclaration environnementale..."
                  />
                </div>

                <button
                  onClick={handleRunAiParsing}
                  disabled={isParsing}
                  className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-purple-950/50"
                >
                  <Sparkles className={`w-4 h-4 ${isParsing ? 'animate-spin' : ''}`} />
                  {isParsing ? 'Demande en cours...' : 'Demander une analyse (service indisponible)'}
                </button>

                {statusMessage && (
                  <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-[11px] text-slate-300 flex items-center gap-2">
                    <Info className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span>{statusMessage}</span>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: Parsed Result View */}
            <div className="lg:col-span-7 space-y-4">
              {!parseResult ? (
                <div className="p-12 bg-slate-900/60 border border-dashed border-slate-800 rounded-2xl text-center space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-purple-400 mx-auto">
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-white">Prêt pour l'extraction structurée</h4>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Sélectionnez un échantillon ou collez un devis, puis cliquez sur « Lancer l’Extraction IA ». Les postes de coûts, facteurs carbone et garanties apparaîtront ici.
                  </p>
                </div>
              ) : (
                <div className="p-5 bg-slate-900/95 border border-slate-800 rounded-xl space-y-5">
                  {/* Result Header & Score */}
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-800">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded text-[10px] font-mono font-bold">
                          DONNÉES À VÉRIFIER
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          Réf. {parseResult.offerReference}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-white mt-1">
                        {parseResult.extractedSupplier.name}
                      </h3>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {parseResult.extractedSupplier.siren ? `SIREN : ${parseResult.extractedSupplier.siren} · ` : ''}
                        Origine : {parseResult.extractedSupplier.country}
                      </div>
                    </div>

                    <div className="text-right space-y-1">
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-950/80 border border-purple-800/80 rounded-lg text-purple-300 font-mono text-xs font-bold">
                        <Sparkles className="w-3.5 h-3.5" />
                        Confiance estimée (non vérifiée) : {parseResult.confidenceScore}%
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        Non vérifié — révision humaine requise
                      </div>
                    </div>
                  </div>

                  {/* Summary Callout */}
                  <div className="p-3 bg-purple-950/30 border border-purple-900/50 rounded-lg space-y-1.5 text-xs">
                    <div className="font-semibold text-purple-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Synthèse automatique — à vérifier
                    </div>
                    <p className="text-slate-300 text-[11px] leading-relaxed">
                      {parseResult.summaryAnalysis}
                    </p>
                  </div>

                  {/* Extracted Core Figures Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-0.5">
                      <div className="text-[10px] text-slate-400 font-sans">Prix Facial Total</div>
                      <div className="text-base font-bold text-white">
                        {parseResult.apparentTotal.toLocaleString('fr-FR')} €
                      </div>
                      <div className="text-[10px] text-slate-500 font-sans">
                        {parseResult.apparentUnitPrice.toLocaleString('fr-FR')} € / unité
                      </div>
                    </div>

                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-0.5">
                      <div className="text-[10px] text-slate-400 font-sans">Volume / Unités</div>
                      <div className="text-base font-bold text-sky-400">
                        {parseResult.quantity} <span className="text-xs font-sans text-slate-400">{parseResult.unitName}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-sans">Quantité contractuelle</div>
                    </div>

                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-0.5">
                      <div className="text-[10px] text-slate-400 font-sans">Garantie & Délais</div>
                      <div className="text-base font-bold text-emerald-400">
                        {parseResult.warrantyMonths} <span className="text-xs font-sans text-slate-400">mois</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-sans">
                        Livraison : {parseResult.deliveryLeadTimeWeeks} sem.
                      </div>
                    </div>

                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-0.5">
                      <div className="text-[10px] text-slate-400 font-sans">Note Technique</div>
                      <div className="text-base font-bold text-indigo-400">
                        {parseResult.technicalSuitabilityScore} <span className="text-xs text-slate-500">/ 100</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-sans">Évaluation technique non vérifiée</div>
                    </div>
                  </div>

                  {/* Cost Items Table */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                      <span>Postes de Coûts TCO Détectés ({parseResult.costItems.length})</span>
                      <span className="text-[10px] text-slate-500 font-mono">Décomposition détaillée</span>
                    </div>

                    <div className="border border-slate-800 rounded-lg overflow-hidden font-mono text-xs">
                      <table className="w-full text-left">
                        <thead className="bg-slate-950 text-slate-400 text-[11px] font-sans">
                          <tr>
                            <th className="py-2 px-3">Catégorie TCO</th>
                            <th className="py-2 px-3">Désignation</th>
                            <th className="py-2 px-3 text-right">Montant HT</th>
                            <th className="py-2 px-3 text-center">Fiabilité</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 bg-slate-950/60">
                          {parseResult.costItems.map((ci) => (
                            <tr key={ci.id} className="hover:bg-slate-900/40">
                              <td className="py-2 px-3 text-slate-400 font-sans capitalize text-[11px]">
                                {ci.category.replace(/_/g, ' ')}
                              </td>
                              <td className="py-2 px-3 text-white font-sans text-[11px]">
                                <div>{ci.label}</div>
                                {ci.notes && <div className="text-[10px] text-slate-500">{ci.notes}</div>}
                              </td>
                              <td className={`py-2 px-3 text-right font-bold ${ci.amount < 0 ? 'text-emerald-400' : 'text-slate-200'}`}>
                                {ci.amount.toLocaleString('fr-FR')} €
                              </td>
                              <td className="py-2 px-3 text-center text-slate-400 text-[11px]">
                                <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 text-[10px]">
                                  {ci.confidenceLevel}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Carbon Footprint Items */}
                  {parseResult.carbonItems.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                        <span>Empreinte Carbone & Facteurs ACV ({parseResult.carbonItems.length})</span>
                        <span className="text-[10px] text-emerald-400 font-mono">Donnée extraite — conformité non évaluée</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {parseResult.carbonItems.map((cb, idx) => (
                          <div key={idx} className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-mono font-bold">
                                {cb.scope}
                              </span>
                              <span className="text-emerald-300 font-mono font-bold">
                                {cb.emissionsTCO2e} tCO2e
                              </span>
                            </div>
                            <div className="font-medium text-white text-[11px]">{cb.label}</div>
                            <div className="text-[10px] text-slate-500 font-mono">Source : {cb.factorSource}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Banner: Inject into Project */}
                  <div className="p-4 bg-purple-950/40 border border-purple-800/80 rounded-xl flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-white text-xs flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        Données extraites — révision humaine requise
                      </div>
                      <div className="text-[11px] text-slate-300 mt-0.5">
                        Ajoutez cette proposition au projet <strong className="text-white">"{project.name}"</strong> pour lancer le calcul de coût complet et le comparateur.
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {injectedSuccess ? (
                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5" /> Offre ajoutée localement
                          </span>
                          {onNavigateToComparator && (
                            <button
                              onClick={onNavigateToComparator}
                              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
                            >
                              <span>Voir le Comparateur</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={handleInjectIntoProject}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors shadow-lg shadow-emerald-950/40"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>Ajouter comme donnée non vérifiée</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Specification Tab */}
      {activeSubTab === 'spec' && (
        <div className="p-6 bg-slate-900/90 border border-slate-800 rounded-xl space-y-4 text-xs text-slate-300">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              État du traitement documentaire
            </h3>
            <span className="text-purple-400 font-mono font-bold">Références réglementaires non vérifiées</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
              <div className="font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                1. Traitement externe désactivé
              </div>
              <p className="text-slate-400 text-[11px]">
                Aucun document n’est transmis à un modèle externe. L’analyse reste désactivée tant que les protections d’accès et de données ne sont pas disponibles.
              </p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
              <div className="font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                2. Décomposition ACV Modules A, B, C, D
              </div>
              <p className="text-slate-400 text-[11px]">
                En production, aucun parseur FDES ou EPD n’est actif. Les exemples préchargés sont fictifs et ne constituent pas des sources de données.
              </p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
              <div className="font-bold text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                3. Auditabilité & Refus de la Fausse Précision
              </div>
              <p className="text-slate-400 text-[11px]">
                Aucun score de confiance n’est validé ni aucune conformité réglementaire vérifiée par le système.
              </p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
              <div className="font-bold text-white flex items-center gap-2">
                <Scale className="w-4 h-4 text-sky-400" />
                4. Raccordement direct au Moteur TCO
              </div>
              <p className="text-slate-400 text-[11px]">
                Aucun raccordement automatique au moteur TCO n’est activé dans cette version.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
