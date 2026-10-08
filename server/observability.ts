/**
 * TrueTCO — Journalisation structurée et mesures
 * ---------------------------------------------------------------------------
 * Remplace les écritures `console.*` dispersées. Ce que cela change réellement :
 *
 *  1. Chaque ligne est un OBJET JSON : elle peut être collectée, filtrée et
 *     alertée (un texte libre ne peut pas l'être correctement).
 *  2. Chaque ligne porte un identifiant de corrélation : la même valeur est
 *     renvoyée à l'utilisateur dans la réponse d'erreur, ce qui permet de relier
 *     un incident signalé à la trace serveur exacte.
 *  3. Les champs sensibles sont MASQUÉS par liste de noms, jamais oubliés au cas
 *     par cas : un mot de passe ou un jeton ne doit pas se retrouver dans un
 *     fichier de journal.
 *  4. Le niveau est paramétrable (TRUETCO_LOG_LEVEL) et la sortie peut être
 *     désactivée dans les tests (TRUETCO_LOG_SILENT) sans modifier le code.
 *
 * Mesures : des compteurs simples (requêtes, erreurs par code, durée) sont
 * exposés par `/api/metrics` pour une supervision minimale. Ce n'est pas encore
 * un exportateur Prometheus, et cela n'est pas présenté comme tel.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Noms de champs dont la valeur ne doit JAMAIS être écrite dans un journal. */
const REDACTED_KEYS = [
  'password',
  'newpassword',
  'currentpassword',
  'token',
  'tokenhash',
  'authorization',
  'cookie',
  'secret',
  'apikey',
  'api_key',
  'privatekey',
  'session',
  'sessionid',
  'refreshtoken',
  'accesstoken',
];

export interface LogFields {
  correlationId?: string | null;
  userId?: string | null;
  organizationId?: string | null;
  projectId?: string | null;
  route?: string | null;
  method?: string | null;
  status?: number;
  durationMs?: number;
  code?: string | null;
  [key: string]: unknown;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[tronqué]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: process.env.NODE_ENV === 'production' ? undefined : value.stack };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_KEYS.includes(key.toLowerCase().replace(/[_-]/g, ''))) {
        result[key] = '[masqué]';
        continue;
      }
      result[key] = redact(item, depth + 1);
    }
    return result;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…[tronqué]`;
  return value;
}

function currentLevel(): LogLevel {
  const configured = (process.env.TRUETCO_LOG_LEVEL ?? 'info').toLowerCase();
  if (configured === 'debug' || configured === 'info' || configured === 'warn' || configured === 'error') return configured;
  return 'info';
}

function writing(): boolean {
  return process.env.TRUETCO_LOG_SILENT !== 'true' && process.env.NODE_ENV !== 'test';
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(context: LogFields): Logger;
}

export function createLogger(context: LogFields = {}): Logger {
  const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return;
    if (!writing()) return;

    const payload = {
      ts: new Date().toISOString(),
      level,
      event,
      ...(redact({ ...context, ...fields }) as Record<string, unknown>),
    };

    const line = JSON.stringify(payload);
    // La sortie d'erreur est réservée aux niveaux warn/error : un collecteur peut
    // ainsi distinguer les incidents des informations de fonctionnement.
    if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    child: (childContext) => createLogger({ ...context, ...childContext }),
  };
}

/** Journal partagé du serveur. */
export const logger = createLogger({ service: 'truetco-api' });

// -----------------------------------------------------------------------------
// Mesures
// -----------------------------------------------------------------------------
interface MetricState {
  startedAt: number;
  requests: number;
  errors: number;
  serverErrors: number;
  authFailures: number;
  byStatus: Record<string, number>;
  byRoute: Record<string, number>;
  durationSumMs: number;
  durationMaxMs: number;
}

const metrics: MetricState = {
  startedAt: Date.now(),
  requests: 0,
  errors: 0,
  serverErrors: 0,
  authFailures: 0,
  byStatus: {},
  byRoute: {},
  durationSumMs: 0,
  durationMaxMs: 0,
};

/** Nom de route sans identifiant : `/api/projects/<uuid>/offers` → `/api/projects/:id/offers`. */
function routeKey(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+/g, '/:n')
    .split('?')[0];
}

export function recordRequest(input: { path: string; status: number; durationMs: number }): void {
  metrics.requests += 1;
  metrics.byStatus[String(input.status)] = (metrics.byStatus[String(input.status)] ?? 0) + 1;
  const key = `${routeKey(input.path)}`;
  metrics.byRoute[key] = (metrics.byRoute[key] ?? 0) + 1;
  metrics.durationSumMs += input.durationMs;
  metrics.durationMaxMs = Math.max(metrics.durationMaxMs, input.durationMs);
  if (input.status >= 400) metrics.errors += 1;
  if (input.status >= 500) metrics.serverErrors += 1;
  if (input.status === 401 || input.status === 403) metrics.authFailures += 1;
}

export function metricsSnapshot(): Record<string, unknown> {
  const uptimeSeconds = Math.round((Date.now() - metrics.startedAt) / 1000);
  return {
    uptimeSeconds,
    requests: metrics.requests,
    errors: metrics.errors,
    serverErrors: metrics.serverErrors,
    authFailures: metrics.authFailures,
    averageDurationMs: metrics.requests === 0 ? 0 : Math.round((metrics.durationSumMs / metrics.requests) * 10) / 10,
    maxDurationMs: metrics.durationMaxMs,
    byStatus: metrics.byStatus,
    // Les routes les plus sollicitées : utile pour repérer un appel en boucle.
    topRoutes: Object.entries(metrics.byRoute)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([route, count]) => ({ route, count })),
  };
}

/** Réinitialisation réservée aux tests. */
export function resetMetrics(): void {
  metrics.startedAt = Date.now();
  metrics.requests = 0;
  metrics.errors = 0;
  metrics.serverErrors = 0;
  metrics.authFailures = 0;
  metrics.byStatus = {};
  metrics.byRoute = {};
  metrics.durationSumMs = 0;
  metrics.durationMaxMs = 0;
}
