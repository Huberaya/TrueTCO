# Préparation Clerk Production — état et limites

**Décision : NON QUALIFIÉ pour une instance Clerk Production réelle.** Le code candidat et ses tests locaux sont revus; aucun projet/instance Clerk, clé Production, session JWT réelle, configuration Dashboard ni variables Vercel de production n’a été vérifié. Aucune valeur secrète n’a été lue, déchiffrée, affichée, copiée ou modifiée.

## Éléments logiciels vérifiés

- `createClerkSessionMiddleware` utilise `@clerk/express` officiel. Il exige côté serveur une clé secrète `sk_`, une clé publishable `pk_`, une liste d’authorized parties exacte sans wildcard et une audience JWT non vide/sans espaces ni joker. Les clés d’exemple sont rejetées par la détection de placeholders. Une mauvaise configuration renvoie 503 pour les API et laisse uniquement la liveness `GET /api/health` accessible.
- Le SDK reçoit la clé secrète côté serveur et applique sa vérification de signature/JWKS et de claims; l’audience et les authorized parties sont configurées explicitement. Le test `src/server/clerkTokenVerification.test.ts` utilise `verifyToken` officiel sur une paire RSA générée localement et vérifie le rejet du token malformé, expiré, du mauvais issuer, de la mauvaise audience et d’une authorized party non autorisée. La valeur `issuer` de ce test est un issuer local fictif : ce n’est ni une clé/JWT réelle ni une validation d’instance Production.
- `parseAuthorizedParties` n’accepte que des origins exactes HTTPS (HTTP seulement pour localhost/127.0.0.1), sans chemin, wildcard ou autre protocole. `azp` est contrôlé par le vérificateur Clerk. Ce n’est pas une validation indépendante de l’en-tête HTTP `Origin` ni une politique CORS; aucune route métier n’est ouverte.
- Le middleware d’identité lit seulement le résultat attaché à la requête par `getAuth` après Clerk. Il ignore les `organization_id`, rôles, identités, headers, query/body et claims d’organisation envoyés par le client.
- `findActiveTenantMembership` utilise le sujet Clerk vérifié pour chercher les adhésions pré-provisionnées avec `LIMIT 2`; exactement une ligne active, UUID/tenant/rôle valides est requise. Zéro, doublon, ligne inactive ou invalide échoue fermé. L’index partiel unique sur `users.clerk_id` empêche une identité multi-organisation dans le modèle actuel; pas de sélection d’organisation par le client.
- `withTenantSqlTransaction` pose `organization_id`, `user_id` et `clerk_user_id` avec `set_config(..., true)` dans la transaction, revalide l’adhésion active, puis commit/rollback et release. Le lookup préliminaire ne pose que le GUC Clerk pour la politique RLS de lecture étroite de l’utilisateur correspondant. Aucun mécanisme n’autorise une identité directement fournie par le client.
- L’identité échoue en 401 sans session, 403 sans membership valide, 503 en cas d’échec du contrôle d’accès; les erreurs ne renvoient pas de secret. RBAC et identity middleware restent des candidats et ne sont pas montés dans `server.ts`.
- `createApplication` monte Clerk → gate global fail-closed; middleware tenant optionnel non configuré; aucune route métier/API/session/tenant n’est ajoutée. Les tests P0.3 couvrent variantes encodées de chemin, headers/tenant forgés et absence d’accès aux anciens handlers. Seul `GET /api/health` reste public.

## Non qualifié sur Production

- Le dépôt ne contient que des exemples dans `.env.example`; ils ne sont pas des valeurs de déploiement.
- L’accès Vercel en lecture de métadonnées projet/environnements a retourné **Access denied** pour l’intégration connectée. Le CLI Vercel et la configuration locale `.vercel` ne sont pas disponibles. Aucun nom/cible de variable de production, état de clé, authorized party configurée, audience ou issuer d’instance n’est donc attesté.
- Aucun compte/projet Clerk, mode Production, domaine, origine, JWT signé par l’instance, cookie/session, JWKS, rotation de clés, template d’audience ou comportement de révocation n’a été vérifié. Les tests RSA locaux qualifient seulement le chemin de code de vérification Clerk.
- L’application ne raccorde pas le pool Neon candidat et ne monte pas le middleware de résolution d’adhésion. La compatibilité de bout en bout Clerk → Vercel → Neon → transaction RLS reste donc non testée.

**Conclusion opérationnelle :** la préparation fail-closed est qualifiée par lecture du code et tests locaux seulement. La qualification **Clerk Production = NON QUALIFIÉE** faute d’accès/configuration et de JWT réel autorisé. Ne pas activer un fournisseur, modifier clé/variable, configurer un JWT template ou ouvrir de route sur la seule base de cette PR.

## Contrôles préalables futurs (à réaliser par le propriétaire Clerk/Vercel, sans communiquer les secrets)

1. Confirmer dans le Dashboard l’instance **Production** et le domaine issuer attendu; vérifier que le domaine/API keys de Production sont distincts du mode Development.
2. Confirmer que le serveur Vercel reçoit une secret key Production, la publishable key publique correspondante, les authorized parties exactes par environnement et l’audience convenue. Comparer uniquement noms/cibles/état de présence; ne pas imprimer les valeurs.
3. Vérifier les domaines de cookies, redirect URLs, allowed origins/CORS et authorized parties; l’allowlist de `azp` n’est pas un substitut aux règles de navigateur.
4. Tester avec un compte autorisé et un JWT de courte durée émis par l’instance Production dans un environnement de test approuvé; ne pas poster ni sauvegarder le token dans un ticket/log. Tester issuer, signature/JWKS, expiration, audience, authorized party, membership absent/inactif/doublon et révocation.
5. Garder l’API métier fail-closed jusqu’à revue sécurité/métier de la résolution d’adhésion, transaction RLS réelle sous rôle non-owner `NOBYPASSRLS`, et approbation séparée des permissions RBAC.

Aucun utilisateur Clerk ou membership n’a été créé/modifié et aucun test Production n’a été tenté.
