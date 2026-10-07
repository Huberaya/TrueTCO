import React, { useState, useRef, useEffect } from 'react';
import {
  Fingerprint,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Download,
  Printer,
  FileCheck2,
  Lock,
  QrCode,
  PenTool,
  RotateCcw,
  AlertTriangle,
  UserCheck,
  FileText,
  BadgeCheck,
  Copy,
  Check,
} from 'lucide-react';
import { AdjudicationCertificate, DigitalSignatureRecord, Project, SupplierOffer, SignatureRole } from '../types/domain';
import { SignatureService } from '../services/signatureService';

interface DigitalSignatureViewProps {
  project: Project;
  offers: SupplierOffer[];
}

export const DigitalSignatureView: React.FC<DigitalSignatureViewProps> = ({
  project,
  offers,
}) => {
  const winningOffer = offers.find((o) => o.isResponsibleCandidate) || offers[0];

  const [certificate, setCertificate] = useState<AdjudicationCertificate>(() =>
    SignatureService.getCertificate(project.id, winningOffer, project)
  );

  const [activeSignModalRole, setActiveSignModalRole] = useState<SignatureRole | null>(null);
  const [signerNameInput, setSignerNameInput] = useState('');
  const [signerTitleInput, setSignerTitleInput] = useState('');
  const [signerEmailInput, setSignerEmailInput] = useState('');
  const [signerComment, setSignerComment] = useState('Lu et approuvé. Engagement budgétaire et conformité TCO/CSRD validés sans réserve.');
  const [consentChecked, setConsentChecked] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);

  // Canvas ref for signature
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    if (activeSignModalRole) {
      const existing = certificate.signatures.find((s) => s.role === activeSignModalRole);
      if (existing) {
        setSignerNameInput(existing.signerName);
        setSignerTitleInput(existing.signerTitle);
        setSignerEmailInput(existing.signerEmail);
      }
      setHasDrawn(false);
      setConsentChecked(false);
    }
  }, [activeSignModalRole, certificate]);

  // Canvas drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    setHasDrawn(true);
    const rect = canvas.getBoundingClientRect();
    const x = 'clientX' in e ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
    const y = 'clientY' in e ? e.clientY - rect.top : e.touches[0].clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = '#38bdf8'; // sky-400
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'clientX' in e ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
    const y = 'clientY' in e ? e.clientY - rect.top : e.touches[0].clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleConfirmSignature = () => {
    if (!activeSignModalRole || !consentChecked) return;

    let signatureDataUrl: string | undefined = undefined;
    if (canvasRef.current && hasDrawn) {
      signatureDataUrl = canvasRef.current.toDataURL('image/png');
    }

    const updated = SignatureService.signRole(
      project.id,
      activeSignModalRole,
      signerNameInput,
      signerTitleInput,
      signerEmailInput,
      signerComment,
      signatureDataUrl
    );

    setCertificate(updated);
    setActiveSignModalRole(null);
  };

  const handleCopyHash = () => {
    navigator.clipboard.writeText(certificate.sealedHash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 3000);
  };

  const signedCount = certificate.signatures.filter((s) => s.status === 'signe').length;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
            <Fingerprint className="w-4 h-4" />
            Chantier 9 · Signature Électronique Certifiée & Scellé Numérique
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Circuit d'Engagement Juridique & Attestation eIDAS (Règlement UE 910/2014)
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Formalisation probante de la décision d'arbitrage Comex : scellement cryptographique SHA-256 de l'offre retenue, horodatage certifié RFC 3161 et signatures quadripartites qualifiées (Acheteur, RSE, Finance, DG).
          </p>
        </div>

        <div className="flex items-center gap-2 no-print">
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Printer className="w-3.5 h-3.5 text-slate-400" />
            Imprimer l'Attestation
          </button>
        </div>
      </div>

      {/* Case Seal Status Card */}
      <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl border ${certificate.isFullyExecuted ? 'bg-emerald-950/80 border-emerald-500 text-emerald-400' : 'bg-amber-950/80 border-amber-500 text-amber-400'}`}>
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{certificate.certificateId}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${certificate.isFullyExecuted ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'}`}>
                  {certificate.isFullyExecuted ? 'SCELLÉ COMPLET — VALIDÉ COMEX' : 'EN COURS DE SIGNATURE'}
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Projet : <strong className="text-white">{certificate.projectReference}</strong> · Candidat retenu : <strong className="text-emerald-400">{certificate.winningSupplierName}</strong>
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs font-mono font-bold text-white">
              Progression : {signedCount} / {certificate.signatures.length} Signatures Scellées
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
              Horodatage : {new Date(certificate.generatedAt).toLocaleString('fr-FR')}
            </div>
          </div>
        </div>

        {/* SHA-256 Hash Display */}
        <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2 truncate">
            <Lock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="text-slate-500 shrink-0">Empreinte SHA-256 :</span>
            <span className="text-sky-300 truncate">{certificate.sealedHash}</span>
          </div>
          <button
            onClick={handleCopyHash}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-900 shrink-0 transition-colors"
            title="Copier l'empreinte de sécurité"
          >
            {copiedHash ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Financial Recap Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-xs pt-1">
          <div className="p-2.5 bg-slate-950/60 border border-slate-800/80 rounded-lg">
            <div className="text-[10px] text-slate-400 font-sans">Montant Facial Retenu</div>
            <div className="text-sm font-bold text-white mt-0.5">
              {certificate.awardedTotalAmount.toLocaleString('fr-FR')} € HT
            </div>
          </div>
          <div className="p-2.5 bg-slate-950/60 border border-slate-800/80 rounded-lg">
            <div className="text-[10px] text-slate-400 font-sans">TCO Global LCC</div>
            <div className="text-sm font-bold text-emerald-400 mt-0.5">
              {certificate.awardedTcoAmount.toLocaleString('fr-FR')} €
            </div>
          </div>
          <div className="p-2.5 bg-slate-950/60 border border-slate-800/80 rounded-lg">
            <div className="text-[10px] text-slate-400 font-sans">CO2 Évité Net</div>
            <div className="text-sm font-bold text-teal-400 mt-0.5">
              {certificate.awardedCarbonAvoidedTonnes} tCO2e
            </div>
          </div>
          <div className="p-2.5 bg-slate-950/60 border border-slate-800/80 rounded-lg">
            <div className="text-[10px] text-slate-400 font-sans">Norme Juridique</div>
            <div className="text-sm font-bold text-indigo-400 mt-0.5">
              eIDAS Qualifié QES
            </div>
          </div>
        </div>
      </div>

      {/* 4 Signatures Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {certificate.signatures.map((sig) => {
          const isSigned = sig.status === 'signe';

          return (
            <div
              key={sig.id}
              className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition-colors ${
                isSigned
                  ? 'bg-slate-900/90 border-slate-800'
                  : 'bg-amber-950/10 border-amber-900/40'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`p-1.5 rounded-lg ${
                        isSigned ? 'bg-emerald-950 text-emerald-400' : 'bg-amber-950 text-amber-400'
                      }`}
                    >
                      {isSigned ? <BadgeCheck className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                    </span>
                    <div>
                      <div className="text-xs uppercase tracking-wider font-bold text-slate-400 font-mono">
                        Visa {sig.role.toUpperCase()}
                      </div>
                      <div className="font-bold text-white text-sm">{sig.signerName}</div>
                      <div className="text-[11px] text-slate-400">{sig.signerTitle}</div>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                      isSigned
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : 'bg-amber-950 text-amber-400 border border-amber-800'
                    }`}
                  >
                    {isSigned ? 'SIGNÉ eIDAS' : 'EN ATTENTE'}
                  </span>
                </div>

                {isSigned ? (
                  <div className="p-3 bg-slate-950 border border-slate-800/80 rounded-lg space-y-2 text-xs font-mono">
                    <div className="text-slate-300 italic font-sans text-[11px]">"{sig.comment}"</div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-900">
                      <span>Certificat : {sig.certificateSerial}</span>
                      <span>Horodaté : {new Date(sig.signedAt).toLocaleDateString('fr-FR')}</span>
                    </div>
                    {sig.signatureDataUrl && (
                      <div className="pt-1 border-t border-slate-900 flex justify-center">
                        <img src={sig.signatureDataUrl} alt="Signature manuscrite" className="h-9 opacity-85 invert" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded-lg text-xs text-amber-300">
                    En attente de signature par le signataire habilité.
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono">
                  {isSigned ? `Réf: ${sig.auditTrailRef}` : 'Action requise'}
                </span>

                <button
                  onClick={() => setActiveSignModalRole(sig.role)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    isSigned
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/40'
                  }`}
                >
                  <PenTool className="w-3.5 h-3.5" />
                  <span>{isSigned ? 'Modifier le visa' : 'Signer électroniquement'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Signature Modal */}
      {activeSignModalRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Fingerprint className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white text-base">
                  Signature Électronique Certifiée · Visa {activeSignModalRole.toUpperCase()}
                </h3>
              </div>
              <button onClick={() => setActiveSignModalRole(null)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Nom du signataire</label>
                  <input
                    type="text"
                    value={signerNameInput}
                    onChange={(e) => setSignerNameInput(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Fonction / Titre</label>
                  <input
                    type="text"
                    value={signerTitleInput}
                    onChange={(e) => setSignerTitleInput(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Motivation / Visa décisionnel</label>
                <textarea
                  rows={2}
                  value={signerComment}
                  onChange={(e) => setSignerComment(e.target.value)}
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
              </div>

              {/* Signature Canvas */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-400">Tracé de signature manuscrite (Tactile ou Souris)</label>
                  <button
                    type="button"
                    onClick={clearCanvas}
                    className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Effacer
                  </button>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden cursor-crosshair">
                  <canvas
                    ref={canvasRef}
                    width={450}
                    height={110}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="w-full h-[110px] block"
                  />
                </div>
                <div className="text-[10px] text-slate-500 mt-1 font-mono">
                  Certificat émis : ANSSI / CertEurope eIDAS QES · Algorithme SHA-256 + RSA-4096
                </div>
              </div>

              {/* Consent checkbox */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="consentCheck"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5 rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <label htmlFor="consentCheck" className="text-[11px] text-slate-300 leading-relaxed cursor-pointer select-none">
                  Je certifie sur l’honneur avoir vérifié l’exactitude de l’arbitrage TCO/LCC et donne mon accord exprès pour l'engagement juridique et financier de la dépense (Règlement eIDAS art. 25).
                </label>
              </div>

              {/* Modal buttons */}
              <div className="pt-2 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSignModalRole(null)}
                  className="px-3 py-2 text-slate-400 hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSignature}
                  disabled={!consentChecked || !signerNameInput.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-lg shadow-lg shadow-emerald-950/40"
                >
                  Apposer la Signature Électronique Scellée
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
