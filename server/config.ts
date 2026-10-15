import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_JWT_KEY: z.string().optional(),
  /** Origines autorisées à émettre des jetons (claim `azp`). Ex: https://truetco.vercel.app */
  CLERK_AUTHORIZED_PARTIES: csv,
  /** Identifiants Clerk (user_...) des administrateurs de la plateforme. */
  PLATFORM_ADMIN_CLERK_IDS: csv,
  /** Nombre de proxys de confiance devant l'app (Vercel/Cloud Run = 1). */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** En production : refuse de démarrer si la connexion peut contourner le RLS. */
  REQUIRE_RLS: bool,
  GEMINI_API_KEY: z.string().optional(),
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  isProd: boolean;
  port: number;
  databaseUrl?: string;
  clerkSecretKey?: string;
  clerkJwtKey?: string;
  clerkAuthorizedParties: string[];
  platformAdminClerkIds: string[];
  trustProxy: number;
  requireRls: boolean;
  geminiApiKey?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  const cfg: Config = {
    nodeEnv: e.NODE_ENV,
    isProd: e.NODE_ENV === 'production',
    port: e.PORT,
    databaseUrl: e.DATABASE_URL || undefined,
    clerkSecretKey: e.CLERK_SECRET_KEY || undefined,
    clerkJwtKey: e.CLERK_JWT_KEY || undefined,
    clerkAuthorizedParties: e.CLERK_AUTHORIZED_PARTIES,
    platformAdminClerkIds: e.PLATFORM_ADMIN_CLERK_IDS,
    trustProxy: e.TRUST_PROXY,
    requireRls: e.REQUIRE_RLS,
    geminiApiKey: e.GEMINI_API_KEY || undefined,
  };

  if (cfg.isProd) {
    const missing: string[] = [];
    if (!cfg.databaseUrl) missing.push('DATABASE_URL');
    if (!cfg.clerkSecretKey && !cfg.clerkJwtKey) missing.push('CLERK_SECRET_KEY (ou CLERK_JWT_KEY)');
    if (cfg.clerkAuthorizedParties.length === 0) missing.push('CLERK_AUTHORIZED_PARTIES');
    if (missing.length) {
      throw new Error(`Configuration de production invalide, variables manquantes : ${missing.join(', ')}`);
    }
  }
  return cfg;
}
