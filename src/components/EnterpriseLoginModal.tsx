/**
 * TrueTCO — Connexion (état réel de l'instance)
 * ---------------------------------------------------------------------------
 * CE QUI A ÉTÉ RETIRÉ, ET POURQUOI
 * Cet écran s'intitulait « Portail d'Authentification Entreprise & SSO » et
 * affichait :
 *   - un annuaire de quatre collaborateurs INVENTÉS (noms, fonctions, services)
 *     présentés comme les comptes de l'entreprise, avec un fournisseur d'identité
 *     attribué à chacun (Okta SAML 2.0, Entra ID, Auth0, Google Workspace) ;
 *   - des badges « ISO 27001 · SOC 2 Type II » et « Connexion certifiée » alors
 *     qu'aucune certification n'existe ;
 *   - un sélecteur « Rôle Métier Attribué par l'Annuaire » qui n'était transmis à
 *     personne : le rôle vient de la base, jamais du navigateur. Le sélecteur
 *     laissait croire qu'on choisit ses droits ;
 *   - des affirmations juridiques (« Conformité CAC & Article L. 823-10 »,
 *     « chiffrement des flux de bout en bout », « Serveur d'Identité Connecté
 *     (Neon PostgreSQL) ») qu'aucune configuration ne corrobore.
 *
 * CE QUE FAIT L'ÉCRAN DÉSORMAIS
 *   - il interroge `/api/auth/config` et affiche ce que le serveur déclare :
 *     connecteurs fédérés réellement déployés (aucun aujourd'hui), mode
 *     démonstration activé ou non, MFA/SCIM/fédération à l'état réel ;
 *   - il ne propose la connexion que si le serveur l'autorise ; sinon il écrit que
 *     la connexion est indisponible et pourquoi ;
 *   - il n'invente aucune identité : c'est l'utilisateur qui saisit son adresse,
 *     et le serveur refuse tout compte inexistant ou inactif ;
 *   - après connexion, l'avertissement du serveur (session de démonstration sans
 *     mot de passe ni second facteur) est affiché, et non plus ignoré.
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { AuthInstanceConfig, AuthService } from '../services/authService';
import {
  ShieldCheck,
  Lock,
  CheckCircle2,
  X,
  User,
  ArrowRight,
  AlertCircle,
  Loader2,
  Info,
} from 'lucide-react';

interface EnterpriseLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EnterpriseLoginModal: React.FC<EnterpriseLoginModalProps> = ({ isOpen, onClose }) => {
  const { loginWithSSO, user: currentUser } = useAuth();
  const [email, setEmail] = useState('');
  const [organizationDomain, setOrganizationDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [config, setConfig] = useState<AuthInstanceConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    AuthService.getAuthConfig()
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .finally(() => {
        if (!cancelled) setConfigLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const demoMode = config?.demoMode === true;
  const federatedProviders = config?.federatedProviders ?? [];
  const loginAvailable = demoMode || federatedProviders.length > 0;

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim().includes('@')) {
      setErrorMsg('Saisissez l’adresse professionnelle du compte à utiliser sur cette instance.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      await loginWithSSO({
        email: email.trim().toLowerCase(),
        domain: organizationDomain.trim() ? organizationDomain.trim().toLowerCase() : undefined,
      });
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Échec de l'authentification.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* En-tête : état réel de l'instance */}
        <div className="p-6 bg-slate-950 border-b border-slate-800 flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-2 py-0.5 border rounded-full text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1 ${
                  demoMode
                    ? 'bg-amber-950 text-amber-300 border-amber-800/80'
                    : 'bg-slate-900 text-slate-300 border-slate-700'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {!configLoaded
                  ? 'Configuration en cours de lecture'
                  : demoMode
                    ? 'Mode démonstration local'
                    : federatedProviders.length > 0
                      ? 'Fournisseur d’identité configuré'
                      : 'Connexion indisponible'}
              </span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">Connexion</h2>
            <p className="text-xs text-slate-400">
              {demoMode
                ? 'Instance de recette ou de démonstration : la session est ouverte sans mot de passe, sans second facteur et sans fédération d’identité.'
                : 'Authentification par fournisseur d’identité de l’organisation.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {currentUser ? (
            <div className="p-4 bg-emerald-950/50 border border-emerald-800/60 rounded-xl text-xs text-emerald-200 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                Session active : <strong>{currentUser.fullName}</strong> ({currentUser.email}) — rôle{' '}
                <strong>{currentUser.role}</strong>, organisation <strong>{currentUser.organizationName}</strong>. Le
                rôle provient de la base de données : il n’est pas choisi dans l’interface.
              </div>
            </div>
          ) : null}

          {/* Ce que déclare le serveur sur l'authentification de cette instance */}
          <div className="p-4 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-2 text-slate-200 font-semibold">
              <Info className="w-3.5 h-3.5 text-sky-400" />
              État des connexions sur cette instance (déclaré par le serveur)
            </div>
            {!configLoaded ? (
              <p className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Lecture de `/api/auth/config`…
              </p>
            ) : !config ? (
              <p className="text-rose-300">
                La configuration d’authentification n’a pas pu être lue. L’interface n’en suppose aucune : le serveur
                refusera toute connexion qu’il n’autorise pas.
              </p>
            ) : (
              <>
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    Connecteurs d’identité fédérée (OIDC/SAML) déployés :{' '}
                    <strong className="text-slate-200">
                      {config.federatedProviders.length === 0 ? 'aucun' : config.federatedProviders.join(', ')}
                    </strong>
                  </li>
                  <li>
                    Second facteur (MFA) : <strong className="text-slate-200">{config.mfa ? 'actif' : 'non implémenté'}</strong>
                    {' — '}Provisionnement d’annuaire (SCIM) :{' '}
                    <strong className="text-slate-200">{config.scim ? 'actif' : 'non implémenté'}</strong>
                  </li>
                  <li>
                    Mode démonstration local (session sans mot de passe) :{' '}
                    <strong className="text-slate-200">{config.demoMode ? 'activé' : 'désactivé'}</strong>
                  </li>
                </ul>
                <p className="text-slate-400">{config.note}</p>
              </>
            )}
          </div>

          {/* Formulaire : uniquement si le serveur autorise une connexion */}
          {loginAvailable ? (
            <form onSubmit={handleLogin} className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold block text-xs" htmlFor="login-email">
                  Adresse professionnelle du compte existant sur cette instance
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="prenom.nom@organisation.fr"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[11px] text-slate-500">
                  Aucun compte de démonstration n’est pré-rempli : cette interface n’affiche pas de personnes qu’elle ne
                  peut pas vérifier. Un compte s’obtient par inscription d’organisation ou par invitation.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold block text-xs" htmlFor="login-domain">
                  Domaine de l’organisation (facultatif)
                </label>
                <input
                  id="login-domain"
                  type="text"
                  value={organizationDomain}
                  onChange={(event) => setOrganizationDomain(event.target.value)}
                  placeholder="organisation.fr"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[11px] text-slate-500">
                  À renseigner si la même adresse existe dans plusieurs organisations : le serveur restreint alors la
                  recherche à ce domaine plutôt que de choisir un compte au hasard.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 bg-rose-950/60 border border-rose-800/70 rounded-lg text-xs text-rose-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {demoMode ? 'Ouvrir une session de démonstration' : 'Se connecter via le fournisseur d’identité'}
              </button>
            </form>
          ) : (
            <div className="p-4 bg-rose-950/50 border border-rose-800/70 rounded-xl text-xs text-rose-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                {configLoaded
                  ? "Aucune connexion n'est possible sur cette instance : aucun fournisseur d'identité n'est déployé et le mode démonstration est désactivé. C'est aussi ce que répond l'API — l'écran ne contourne pas ce refus."
                  : 'Vérification de la configuration d’authentification en cours…'}
              </div>
            </div>
          )}

          {/* Traçabilité : ce qui est réellement journalisé */}
          <div className="p-4 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-2 text-slate-200 font-semibold">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              Sessions & traçabilité (état réel)
            </div>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                La session est un jeton conservé dans un cookie <code>HttpOnly</code> / <code>SameSite=Lax</code> (et{' '}
                <code>Secure</code> en production) ; il n’est jamais écrit dans le stockage du navigateur.
              </li>
              <li>
                Chaque connexion, déconnexion, changement de rôle et transition de statut de dossier est journalisée par
                le serveur, dans un journal en écriture serveur uniquement (chaîne de hachage vérifiable).
              </li>
              <li>
                Aucune certification de conformité (ISO 27001, SOC 2, homologation) n’est revendiquée : ce produit n’en
                détient aucune à ce jour.
              </li>
            </ul>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <User className="w-3.5 h-3.5" />
            Les rôles et permissions sont attribués par l’organisation (invitation, annuaire) et appliqués côté API.
          </div>
        </div>
      </div>
    </div>
  );
};
