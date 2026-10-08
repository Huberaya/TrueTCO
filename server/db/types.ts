/**
 * TrueTCO — Contrat d'accès aux données
 * ---------------------------------------------------------------------------
 * Un seul contrat pour toutes les implémentations :
 *   - `PgDb`     : PostgreSQL réel en production (driver `pg`, transactions TCP)
 *   - `PgliteDb` : PostgreSQL réel en test (PGlite/WASM) — mêmes sémantiques,
 *                  y compris Row Level Security, sans service externe.
 *
 * Conséquence volontaire : les tests d'isolation multi-tenant s'exécutent sur
 * un VRAI moteur PostgreSQL avec la VRAIE policy RLS. Ils ne testent pas une
 * imitation du cloisonnement.
 */

export interface Executor {
  /** Requête paramétrée. Les valeurs ne sont jamais concaténées dans le SQL. */
  query<T = any>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Executor {
  /**
   * Transaction applicative : endosse le rôle `truetco_app`, donc SOUMISE AU RLS.
   * Toute écriture métier doit passer par ici (ou par `asOrganization`) : une
   * offre et ses postes de coût, une mutation et son entrée d'audit, forment
   * une unité atomique.
   */
  tx<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;

  /**
   * Transaction administrateur : s'exécute avec les privilèges du propriétaire
   * des tables. Réservée aux migrations, à l'amorçage et aux tâches
   * d'exploitation. Le code applicatif ne doit JAMAIS l'utiliser pour servir une
   * requête utilisateur.
   */
  systemTx<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;

  /**
   * Transaction « en tant qu'organisation » : endosse le rôle applicatif
   * (soumis au RLS) puis positionne `app.current_organization_id` pour la durée
   * de la transaction. `organizationId = null` est une transaction
   * pré-authentification : le contexte est vide, donc RLS refuse tout (échec
   * fermé) et seules les fonctions SECURITY DEFINER restent utilisables.
   */
  asOrganization<T>(organizationId: string | null, fn: (tx: Executor) => Promise<T>): Promise<T>;

  /** Diagnostic de connexion (utilisé au démarrage et par /api/health). */
  status(): Promise<DbStatus>;

  close(): Promise<void>;
}

export interface DbStatus {
  driver: 'postgres' | 'pglite';
  connected: boolean;
  currentUser: string | null;
  /** Vrai si la connexion est propriétaire des tables (donc hors RLS FORCE). */
  isTableOwner: boolean;
  appRoleAssumed: boolean;
  databaseVersion: string | null;
  error?: string;
}

/** Erreur métier porteuse d'un code exploitable par la couche HTTP. */
export class DataError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'FORBIDDEN'
      | 'INVALID_INPUT'
      | 'TENANT_VIOLATION'
      | 'IMMUTABLE'
      | 'DB_ERROR',
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'DataError';
  }
}

const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export function assertSafeRoleName(role: string): string {
  if (!ROLE_PATTERN.test(role)) {
    throw new DataError(`Nom de rôle de base invalide : « ${role} ».`, 'INVALID_INPUT');
  }
  return role;
}

export const APP_ROLE_DEFAULT = 'truetco_app';
export const ORG_SETTING = 'app.current_organization_id';
