/**
 * TrueTCO — Journal d'audit serveur, chaîné et append-only
 * ---------------------------------------------------------------------------
 * Chaque entrée est liée à la précédente par un hachage :
 *
 *   entry_hash = SHA256( previous_hash || contenu_canonique_de_l_entrée )
 *
 * Propriétés obtenues :
 *   - toute modification d'une entrée ancienne casse la chaîne et devient
 *     détectable (`truetco_verify_audit_chain`) ;
 *   - toute suppression dans la chaîne laisse un trou détectable ;
 *   - l'acteur est celui de la SESSION AUTHENTIFIÉE : un nom fourni par le
 *     client n'est jamais utilisé (c'était la faille du journal d'origine).
 *
 * La table est en append-only (policy RLS sans UPDATE/DELETE + trigger
 * d'immuabilité) : l'application ne peut pas réécrire son propre historique.
 */

import crypto from 'crypto';
import { Db, Executor } from './db/types';
import { AuthContext } from './auth/types';


/**
 * Acteur d'une entrée d'audit. Il est TOUJOURS construit par le serveur :
 *  - depuis la session authentifiée (`actorFromContext`) ;
 *  - ou explicitement pour les opérations sans session (connexion, acceptation
 *    d'invitation), où l'identité est celle que le serveur vient d'établir.
 * Un nom d'acteur fourni par le client n'est jamais repris.
 */
export interface AuditActor {
  id: string | null;
  name: string;
  role: string;
}

export function actorFromContext(ctx: AuthContext | null): AuditActor {
  if (!ctx) return { id: null, name: 'Système', role: 'system' };
  return { id: ctx.user.id, name: ctx.user.fullName, role: ctx.user.role };
}

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  fieldChanged?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  justification?: string | null;
  /** Métadonnées de requête (jamais utilisées pour l'identité de l'acteur). */
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  isDemo?: boolean;
}

/**
 * Le hachage est calculé par PostgreSQL (fonctions `truetco_audit_content_hash`
 * et `truetco_audit_entry_hash`, définies par migration). Aucune reconstruction
 * du contenu n'a lieu en JavaScript : il n'existe donc qu'UNE implémentation du
 * format haché, celle qui sert aussi à la vérification.
 */

/** Ajoute une entrée au journal. DOIT être appelée dans la transaction de la mutation décrite. */
export async function recordAudit(
  tx: Executor,
  actor: AuditActor,
  organizationId: string,
  event: AuditEvent
): Promise<void> {
  if (!organizationId) {
    throw new Error("Journal d'audit : organisation indeterminee (contexte absent).");
  }

  const previous = await tx.query<{ entry_hash: string | null }>(
    `SELECT entry_hash FROM audit_logs
      WHERE organization_id = $1
      ORDER BY id DESC
      LIMIT 1`,
    [organizationId]
  );
  const previousHash = previous[0]?.entry_hash ?? null;
  const occurredAt = new Date().toISOString();

  await tx.query(
    `WITH hashed AS (
        SELECT truetco_audit_content_hash(
                 $1::uuid, $2::timestamptz, $3::uuid, $4, $5, $6, $7, $8::uuid, $9::uuid,
                 $10, $11, $12, $13, $16
               ) AS content_hash
     )
     INSERT INTO audit_logs (
        organization_id, occurred_at, actor_id, actor_name, actor_role,
        action, entity_type, entity_id, project_id, field_changed,
        old_value, new_value, justification, ip_address, user_agent,
        correlation_id, previous_hash, content_hash, entry_hash, is_demo
     )
     SELECT $1::uuid, $2::timestamptz, $3::uuid, $4, $5, $6, $7, $8::uuid, $9::uuid,
            $10, $11, $12, $13, $14, $15,
            $16, $17::char(64), hashed.content_hash,
            truetco_audit_entry_hash(hashed.content_hash, $17::text),
            $18
       FROM hashed`,
    [
      organizationId,
      occurredAt,
      actor.id,
      actor.name,
      actor.role,
      event.action,
      event.entityType,
      event.entityId ?? null,
      event.projectId ?? null,
      event.fieldChanged ?? null,
      event.oldValue ?? null,
      event.newValue ?? null,
      event.justification ?? null,
      event.ipAddress ?? null,
      event.userAgent ?? null,
      event.correlationId ?? null,
      previousHash,
      event.isDemo ?? false,
    ]
  );
}

/**
 * Écrit une entrée d'audit dans sa PROPRE transaction. À n'utiliser que lorsque
 * la mutation décrite a déjà été validée par une fonction SQL atomique
 * (invitation acceptée) ou lorsqu'il n'y a rien d'autre à protéger (connexion).
 */
export async function recordAuditStandalone(
  db: Db,
  organizationId: string,
  actor: AuditActor,
  event: AuditEvent
): Promise<void> {
  await db.asOrganization(organizationId, (tx) => recordAudit(tx, actor, organizationId, event));
}

export interface AuditChainStatus {
  totalEntries: number;
  firstBrokenId: string | null;
  firstContentMismatchId: string | null;
  intact: boolean;
}

/** Vérifie l'intégrité de la chaîne d'audit d'une organisation. */
export async function verifyAuditChain(tx: Executor, organizationId: string): Promise<AuditChainStatus> {
  const rows = await tx.query<{ total_entries: string; first_broken_id: string | null; first_content_mismatch_id: string | null }>(
    'SELECT * FROM truetco_verify_audit_chain($1)',
    [organizationId]
  );
  const totalEntries = Number(rows[0]?.total_entries ?? 0);
  const firstBrokenId = rows[0]?.first_broken_id ?? null;
  const firstContentMismatchId = rows[0]?.first_content_mismatch_id ?? null;
  return {
    totalEntries,
    firstBrokenId,
    firstContentMismatchId,
    intact: firstBrokenId === null && firstContentMismatchId === null,
  };
}
