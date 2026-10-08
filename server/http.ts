/**
 * TrueTCO — Socle HTTP : validation d'entrée, erreurs, pagination
 * ---------------------------------------------------------------------------
 * Règles :
 *  - AUCUNE donnée d'entrée n'est utilisée sans validation (type, taille, plage).
 *  - Les erreurs renvoyées au client sont écrites pour un utilisateur, jamais
 *    une trace technique (pas de message SQL, pas de nom de table).
 *  - Toute erreur porte un `code` stable, exploitable par le front et par les tests.
 */

import { NextFunction, Request, RequestHandler, Response } from 'express';
import { DataError } from './db/types';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (code = 'AUTH_REQUIRED', message = 'Authentification requise.') =>
  new HttpError(401, code, message);
export const forbidden = (code: string, message: string) => new HttpError(403, code, message);
export const notFound = (message = 'Ressource introuvable.') => new HttpError(404, 'NOT_FOUND', message);

export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------
export function requireString(value: unknown, field: string, opts: { min?: number; max?: number } = {}): string {
  if (typeof value !== 'string') {
    throw badRequest('INVALID_FIELD', `Le champ « ${field} » est obligatoire et doit être une chaîne de caractères.`);
  }
  const trimmed = value.trim();
  const min = opts.min ?? 1;
  const max = opts.max ?? 500;
  if (trimmed.length < min) {
    throw badRequest('INVALID_FIELD', `Le champ « ${field} » doit contenir au moins ${min} caractère(s).`);
  }
  if (trimmed.length > max) {
    throw badRequest('INVALID_FIELD', `Le champ « ${field} » dépasse la longueur maximale autorisée (${max}).`);
  }
  return trimmed;
}

export function optionalString(value: unknown, field: string, max = 5000): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw badRequest('INVALID_FIELD', `Le champ « ${field} » doit être une chaîne de caractères.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw badRequest('INVALID_FIELD', `Le champ « ${field} » dépasse la longueur maximale autorisée (${max}).`);
  }
  return trimmed === '' ? null : trimmed;
}

export function requireUuid(value: unknown, field: string): string {
  const str = requireString(value, field, { max: 64 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    throw badRequest('INVALID_FIELD', `Le champ « ${field} » n'est pas un identifiant valide.`);
  }
  return str.toLowerCase();
}

export function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw badRequest(
      'INVALID_FIELD',
      `Valeur invalide pour « ${field} ». Valeurs autorisées : ${allowed.join(', ')}.`
    );
  }
  return value as T;
}

export function requireNumber(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; integer?: boolean } = {}
): number {
  const num = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    throw badRequest('INVALID_FIELD', `Le champ « ${field} » doit être un nombre.`);
  }
  if (opts.integer && !Number.isInteger(num)) {
    throw badRequest('INVALID_FIELD', `Le champ « ${field} » doit être un nombre entier.`);
  }
  if (opts.min !== undefined && num < opts.min) {
    throw badRequest('INVALID_NUMBER_RANGE', `Le champ « ${field} » doit être supérieur ou égal à ${opts.min}.`);
  }
  if (opts.max !== undefined && num > opts.max) {
    throw badRequest('INVALID_NUMBER_RANGE', `Le champ « ${field} » doit être inférieur ou égal à ${opts.max}.`);
  }
  return num;
}

export function optionalNumber(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; integer?: boolean } = {}
): number | null {
  if (value === undefined || value === null || value === '') return null;
  return requireNumber(value, field, opts);
}

export function requireArray(value: unknown, field: string, maxLength = 5000): unknown[] {
  if (!Array.isArray(value)) {
    throw badRequest('INVALID_FIELD', `Le champ « ${field} » doit être une liste.`);
  }
  if (value.length === 0) {
    throw badRequest('INVALID_FIELD', `Le champ « ${field} » ne peut pas être vide.`);
  }
  if (value.length > maxLength) {
    throw badRequest('INVALID_FIELD', `Le champ « ${field} » dépasse la taille maximale autorisée (${maxLength}).`);
  }
  return value;
}

export function requireEmail(value: unknown, field = 'email'): string {
  const email = requireString(value, field, { max: 255 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw badRequest('INVALID_EMAIL', `L'adresse e-mail fournie dans « ${field} » n'est pas valide.`);
  }
  return email;
}

export function requireCurrency(value: unknown, field = 'currency'): string {
  const code = requireString(value, field, { min: 3, max: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw badRequest('INVALID_CURRENCY', `Le code devise de « ${field} » doit comporter 3 lettres (ex. EUR).`);
  }
  return code;
}

// -----------------------------------------------------------------------------
// Pagination
// -----------------------------------------------------------------------------
export interface Page {
  limit: number;
  offset: number;
}

export function parsePagination(query: Request['query'], defaultLimit = 50, maxLimit = 200): Page {
  const rawLimit = query.limit;
  const rawOffset = query.offset;
  const limit = rawLimit === undefined ? defaultLimit : requireNumber(rawLimit, 'limit', { min: 1, max: maxLimit, integer: true });
  const offset = rawOffset === undefined ? 0 : requireNumber(rawOffset, 'offset', { min: 0, max: 1_000_000, integer: true });
  return { limit, offset };
}

export function parseUuidQuery(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireUuid(value, field);
}

// -----------------------------------------------------------------------------
// Gestionnaire d'erreurs (aucune fuite technique)
// -----------------------------------------------------------------------------
export function errorHandler(isProd: boolean) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const correlationId = req.correlationId ?? '-';

    // Une erreur portant un statut numérique explicite (HttpError, ou erreur
    // construite par un dépôt avec `code` et `status`) est une erreur MÉTIER :
    // elle doit être renvoyée telle quelle, jamais transformée en 500.
    const withStatus = err as { status?: unknown; code?: unknown; message?: unknown };
    const hasExplicitStatus =
      typeof withStatus?.status === 'number' && withStatus.status >= 400 && withStatus.status < 600 && typeof withStatus.code === 'string';

    if (hasExplicitStatus && !(err instanceof HttpError)) {
      const status = withStatus.status as number;
      if (status >= 500) {
        console.error(`[TrueTCO][${correlationId}] Erreur ${status} (${withStatus.code}) : ${withStatus.message}`);
      }
      res.status(status).json({
        error: String(withStatus.message ?? 'Opération refusée.'),
        code: withStatus.code,
        correlationId,
      });
      return;
    }

    if (err instanceof HttpError) {
      if (err.status >= 500) {
        console.error(`[TrueTCO][${correlationId}] Erreur HTTP ${err.status} (${err.code}) : ${err.message}`);
      }
      res.status(err.status).json({
        error: err.message,
        code: err.code,
        details: err.details,
        correlationId,
      });
      return;
    }

    if (err instanceof DataError) {
      // Journalisation serveur systématique : l'utilisateur reçoit un message
      // lisible, l'exploitant dispose de la cause réelle et du corrélateur.
      console.error(
        `[TrueTCO][${correlationId}] Erreur de données (${err.code}) sur ${req.method} ${req.originalUrl} : ${err.message}` +
          (err.technical ? ` | cause technique : ${err.technical}` : '')
      );
      const status =
        err.code === 'NOT_FOUND'
          ? 404
          : err.code === 'CONFLICT'
            ? 409
            : err.code === 'FORBIDDEN' || err.code === 'TENANT_VIOLATION'
              ? 403
              : err.code === 'INVALID_INPUT' || err.code === 'DB_SCHEMA'
                ? 400
                : 500;
      res.status(status).json({
        error: err.message,
        code: err.code,
        correlationId,
      });
      return;
    }

    const message = (err as Error)?.message ?? 'Erreur interne';
    console.error(`[TrueTCO][${correlationId}] Erreur non gérée :`, err);

    res.status(500).json({
      error: isProd
        ? 'Une erreur interne est survenue. L’incident a été journalisé avec son identifiant de corrélation.'
        : `Erreur interne (développement) : ${message}`,
      code: 'INTERNAL_ERROR',
      correlationId,
    });
  };
}
