/**
 * TrueTCO — Dépôt « fournisseurs ».
 * Toute création/mise à jour est journalisée (qui, quand, quoi, ancienne et
 * nouvelle valeur). Aucune donnée fournisseur n'est inventée : une source
 * peut être absente, elle est alors absente (`source_document_id = NULL`).
 */
import { Db } from '../db/types';
import { actorFromContext, recordAudit } from '../audit';
import { AuthContext } from '../auth/types';

export interface SupplierRow {
  id: string;
  name: string;
  legal_name: string | null;
  country_code: string | null;
  contact_email: string | null;
  incoterm: string | null;
  payment_terms_days: number;
  warranty_months: number;
  esg_rating: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

const SUPPLIER_SELECT = `id, name, legal_name, country_code, contact_email, incoterm,
       payment_terms_days, warranty_months, esg_rating, is_demo, created_at, updated_at`;

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export async function listSuppliers(
  db: Db,
  ctx: AuthContext,
  page: { limit: number; offset: number }
): Promise<{ items: SupplierRow[]; total: number }> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const items = await tx.query<SupplierRow>(
      `SELECT ${SUPPLIER_SELECT} FROM suppliers ORDER BY name LIMIT $1 OFFSET $2`,
      [page.limit, page.offset]
    );
    const [count] = await tx.query<{ total: string }>('SELECT count(*)::text AS total FROM suppliers');
    return { items, total: Number(count?.total ?? 0) };
  });
}

export async function createSupplier(
  db: Db,
  ctx: AuthContext,
  input: {
    name: string;
    legalName?: string | null;
    countryCode?: string | null;
    contactEmail?: string | null;
    incoterm?: string | null;
    paymentTermsDays?: number | null;
    warrantyMonths?: number | null;
    esgRating?: string | null;
    isDemo?: boolean;
  },
  meta: RequestMeta
): Promise<SupplierRow> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const [supplier] = await tx.query<SupplierRow>(
      `INSERT INTO suppliers (organization_id, name, legal_name, country_code, contact_email, incoterm,
                              payment_terms_days, warranty_months, esg_rating, is_demo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${SUPPLIER_SELECT}`,
      [
        ctx.organization.id,
        input.name,
        input.legalName ?? null,
        input.countryCode ?? null,
        input.contactEmail ?? null,
        input.incoterm ?? null,
        input.paymentTermsDays ?? 0,
        input.warrantyMonths ?? 0,
        input.esgRating ?? null,
        input.isDemo ?? false,
      ]
    );
    await recordAudit(tx, actorFromContext(ctx), ctx.organization.id, {
      action: 'supplier.created',
      entityType: 'supplier',
      entityId: supplier.id,
      newValue: JSON.stringify({ name: supplier.name }),
      ...meta,
    });
    return supplier;
  });
}
