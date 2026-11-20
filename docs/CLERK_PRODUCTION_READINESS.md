# Préparation Clerk Production — état et limites

**État : intégration logicielle préparée; Clerk Production et JWT réel NON qualifiés.** Aucun compte/instance Production, aucune clé Production ni aucun JWT émis par une instance réelle n'a été vérifié. Aucun secret n'a été lu, déchiffré, affiché, copié ou modifié.

## Ce que le code prépare

- `createClerkSessionMiddleware` utilise `@clerk/express` et exige les clés serveur/public correspondantes, une audience explicite et des authorized parties exactes, sans wildcard. Une mauvaise configuration échoue fermé; seul `GET /api/health` reste public.
- La vérification de signature/JWKS et des claims est confiée au SDK Clerk. Les tests locaux signent des JWT avec une clé RSA de test et couvrent les cas invalides (expiration, issuer, audience et authorized party). Cela teste le chemin logiciel, pas une instance Clerk Production réelle.
- Le middleware d'identité ne lit que l'état attaché par Clerk vérifié; il ignore les identités, organisations, rôles et claims fournis par le client. Il exige exactement une adhésion locale active correspondant au sujet Clerk vérifié.
- L'adaptateur runtime est monté dans `server.ts` après Clerk. Il utilise exclusivement `DATABASE_URL_RUNTIME`, sans fallback vers `DATABASE_URL`, et effectue paresseusement la recherche d'adhésion. Le principal tenant ne peut provenir que de la ligne locale validée.
- La recherche d'adhésion utilise une transaction et le contexte Clerk transaction-local. Le chemin SQL tenant complet pose les GUC d'organisation/utilisateur/Clerk, revalide l'adhésion et commit/rollback avant de libérer le client. Ces tests locaux ne qualifient pas à eux seuls la connexion Vercel ou Neon.
- Le gate global fail-closed reste après Clerk et le middleware tenant. **Aucune route métier n'est activée**; seules les réponses explicitement prévues pour la liveness sont accessibles. RBAC reste candidat et non activé.

## Ce qui n'est pas qualifié en Production

- Aucune instance Clerk Production, aucun domaine/issuer Production, aucune clé associée ni aucun JWT/session réel n'a été qualifié.
- Les tests cryptographiques utilisent une paire RSA locale et un issuer fictif; ils ne prouvent ni l'intégration au JWKS d'une instance réelle, ni ses cookies, domaines, rotation de clés, révocation ou configuration Dashboard.
- `DATABASE_URL_RUNTIME` n'existe pas dans Vercel Production. Malgré le câblage du middleware et du pool dans `server.ts`, aucune connexion Vercel → Neon n'a donc été observée. La qualification indépendante du rôle Neon `truetco_app` ne prouve pas que Vercel utilise ce rôle (voir `NEON_RUNTIME_ROLE_QUALIFICATION.md`).
- Aucune adhésion réelle n'a été créée ou testée avec un compte Clerk Production; aucune matrice RBAC n'est approuvée/activée.

## Garde-fous et conditions futures

L'absence de configuration Clerk/runtime, une authentification invalide, une adhésion absente/ambiguë ou une panne DB échouent fermé. Aucun fallback tenant, aucune organisation par défaut ni aucun choix d'organisation fourni par le client n'est accepté.

La qualification future nécessite une instance Production et un domaine autorisés, des clés correctement ciblées sans exposition des valeurs, un JWT réel de courte durée testé de façon contrôlée, une connexion Vercel sous `truetco_app`, puis des tests transactionnels/RLS de bout en bout. La mise en service métier et l'activation RBAC exigent une approbation distincte. Clerk Production, JWT live, memberships et RBAC restent différés jusqu'au choix et à l'achat du domaine.

**Conclusion :** le code de préparation est testé localement; Clerk Production et le runtime Vercel ne sont pas qualifiés. Les routes métier demeurent fermées. Aucun secret ou paramètre Clerk/Vercel n'a été consulté ou changé dans le cadre de cette PR.
