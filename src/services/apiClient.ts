/**
 * Client HTTP unique vers l'API TrueTCO.
 *
 * - Le jeton est fourni par Clerk (jamais fabriqué ni stocké en localStorage par l'application).
 * - `x-tenant-id` n'est qu'un SÉLECTEUR parmi les organisations dont l'utilisateur est membre ;
 *   le serveur le vérifie et répond 403 sinon. Il ne confère aucun droit.
 * - Sans session (mode démo local), AUCUNE requête réseau n'est émise : réponse 401 synthétique.
 */
type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;
let activeTenantId: string | null = null;

export const ACTIVE_TENANT_KEY = 'truetco_active_tenant_id';

export function setTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

export function hasServerSession(): boolean {
  return tokenProvider !== null;
}

export function setActiveTenant(tenantId: string | null): void {
  activeTenantId = tenantId;
  if (typeof window === 'undefined') return;
  if (tenantId) localStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
}

export function getActiveTenant(): string | null {
  return activeTenantId;
}

const unauthenticated = () =>
  new Response(JSON.stringify({ error: 'unauthorized', message: 'Aucune session serveur (mode démo local)' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });

export async function apiFetch(input: string, init: RequestInit = {}, opts: { tenantId?: string } = {}): Promise<Response> {
  if (!tokenProvider) return unauthenticated();
  let token: string | null = null;
  try {
    token = await tokenProvider();
  } catch {
    token = null;
  }
  if (!token) return unauthenticated();

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const tenant = opts.tenantId ?? activeTenantId;
  if (tenant) headers.set('x-tenant-id', tenant);
  return fetch(input, { ...init, headers });
}

/** Purge les jetons et profils fabriqués par l'ancien flux SSO factice (ils ne valent plus rien côté serveur). */
export function purgeLegacySessionArtifacts(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('truetco_enterprise_sso_token');
  localStorage.removeItem('truetco_enterprise_sso_user');
}
