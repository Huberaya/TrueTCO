/**
 * TrueTCO — Amorçage d'une organisation et de son premier administrateur
 * ---------------------------------------------------------------------------
 * Utilisation :
 *   npm run db:create-org -- --name "Société Exemple" --slug societe-exemple \
 *       --domain exemple.com --email admin@exemple.com --admin "Prénom Nom"
 *
 * Cette commande ne crée AUCUNE donnée de démonstration : ni dossier, ni offre,
 * ni fournisseur. Elle ne crée pas non plus de moyen de connexion — en
 * production, la connexion passe par le fournisseur d'identité (OIDC/SAML) et
 * l'utilisateur créé ici doit être rattaché à une identité (idp_provider /
 * idp_subject) par l'exploitant.
 */
import 'dotenv/config';
import { createDbFromEnv } from '../server/db/adapters.ts';
import { registerOrganization } from '../server/auth/service.ts';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

const required = ['name', 'slug', 'domain', 'email', 'admin'];
const missing = required.filter((key) => !arg(key));
if (missing.length > 0) {
  console.error(
    `[TrueTCO] Arguments manquants : ${missing.map((m) => `--${m}`).join(', ')}\n` +
      'Exemple : npm run db:create-org -- --name "Société Exemple" --slug societe-exemple --domain exemple.com --email admin@exemple.com --admin "Prénom Nom"'
  );
  process.exit(1);
}

const domain = arg('domain').toLowerCase();
const email = arg('email').toLowerCase();
if (!email.endsWith(`@${domain}`) && !email.endsWith(`.${domain}`)) {
  console.error(`[TrueTCO] L'adresse ${email} n'appartient pas au domaine ${domain}.`);
  process.exit(1);
}

try {
  const db = await createDbFromEnv();
  const created = await registerOrganization(db, {
    organizationName: arg('name'),
    slug: arg('slug').toLowerCase(),
    domain,
    adminEmail: email,
    adminFullName: arg('admin'),
  });
  console.log(`[TrueTCO] Organisation créée : ${created.organizationId}`);
  console.log(`[TrueTCO] Administrateur créé  : ${created.userId} (${email}, rôle org_admin)`);
  console.log(
    '[TrueTCO] Aucun moyen de connexion n’est créé : rattachez cet utilisateur à une identité ' +
      "(OIDC/SAML) ou activez explicitement le mode démonstration sur un environnement de recette."
  );
  await db.close();
} catch (err) {
  console.error('[TrueTCO] Création impossible :', err instanceof Error ? err.message : err);
  process.exit(1);
}
