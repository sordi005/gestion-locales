import { z } from "zod";

type EnvSource = Record<string, string | undefined>;

/**
 * Arma el error de entorno inválido. Lista SOLO los nombres de las variables
 * (sin repetir) y nunca sus valores, para no filtrar secretos a logs ni a pantalla.
 */
function invalidEnvError(error: z.ZodError): Error {
  const names = new Set(error.issues.map((issue) => String(issue.path[0])));
  return new Error(`Variables de entorno inválidas: ${[...names].join(", ")}`);
}

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.url(),
});

export type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  siteUrl: string;
};

export function parsePublicEnv(source: EnvSource): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) throw invalidEnvError(result.error);
  const env = result.data;
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    siteUrl: env.NEXT_PUBLIC_SITE_URL,
  };
}

/**
 * Lee el entorno público de `process.env` por nombre literal: Next solo inyecta
 * en el bundle del navegador los accesos estáticos (`process.env[clave]` o
 * pasar `process.env` entero no funciona en el cliente).
 */
export function readPublicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
}

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export type ServerEnv = {
  supabaseUrl: string;
  supabaseSecretKey: string;
};

export function parseServerEnv(source: EnvSource): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) throw invalidEnvError(result.error);
  const env = result.data;
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseSecretKey: env.SUPABASE_SECRET_KEY,
  };
}
