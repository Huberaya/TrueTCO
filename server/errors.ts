import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Erreur destinée au client : code stable + message sûr (jamais de détail interne). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown
  ) {
    super(message ?? code);
  }
}

export const notFound = (what = 'ressource') => new HttpError(404, 'not_found', `${what} introuvable`);
export const forbidden = (message = 'Accès refusé') => new HttpError(403, 'forbidden', message);
export const unauthorized = (message = 'Authentification requise') => new HttpError(401, 'unauthorized', message);

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Codes SQLSTATE traduits en erreurs client, sans jamais exposer le message PostgreSQL. */
export function mapDbError(err: unknown): HttpError | null {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case '42501': // violation RLS / privilège : on ne distingue pas "interdit" de "inexistant"
      return notFound();
    case '23505':
      return new HttpError(409, 'conflict', 'Cette ressource existe déjà');
    case '23503':
      return new HttpError(422, 'invalid_reference', 'Référence invalide');
    case '23514':
    case '22P02':
    case '22003':
    case '23502':
      return new HttpError(422, 'invalid_value', 'Valeur invalide');
    default:
      return null;
  }
}
