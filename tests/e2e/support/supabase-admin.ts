import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { assertLocalTarget } from "./local-target";

// Clientes de Supabase de los tests E2E. `src/shared/db/admin.ts` importa
// `server-only` y no se puede cargar fuera de Next, así que los tests tienen el
// suyo. La secret key sale del entorno (`.env.local`) y nunca llega a un navegador.
// Todos los que hablan con Supabase se niegan si el destino no es local
// (`assertLocalTarget`): con un `.env.local` de staging crearían, invitarían y
// borrarían usuarios allá y mandarían emails de verdad.

export type IsolatedUser = {
  id: string;
  email: string;
  password: string;
  fullName?: string;
};

const NO_SESSION = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Falta ${name} en el entorno de los E2E (armá .env.local con scripts/ci/local-supabase-env.ts).`,
    );
  }
  return value;
}

/** `e2e-<aleatorio>@e2e.test`: nunca `@demo.test`, que `090-dev-seed` cuenta como seed. */
export function isolatedEmail(): string {
  return `e2e-${randomUUID().replaceAll("-", "").slice(0, 12)}@e2e.test`;
}

/** Cliente con la secret key: solo para preparar y limpiar datos en los tests. */
export function createAdminClient(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseClient {
  assertLocalTarget(env);
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", env),
    requireEnv("SUPABASE_SECRET_KEY", env),
    { auth: NO_SESSION },
  );
}

/** Cliente con la clave publicable, como el navegador de una persona sin sesión. */
export function createPublishableClient(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseClient {
  assertLocalTarget(env);
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", env),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", env),
    { auth: NO_SESSION },
  );
}

/** Crea un usuario con email confirmado y contraseña conocida (aleatoria). */
export async function createIsolatedUser(
  admin: SupabaseClient,
  options: { fullName?: string } = {},
): Promise<IsolatedUser> {
  const email = isolatedEmail();
  const password = `E2e-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    ...(options.fullName === undefined
      ? {}
      : { user_metadata: { full_name: options.fullName } }),
  });
  if (error !== null || data.user === null) {
    throw new Error(
      `No se pudo crear el usuario aislado: ${error?.message ?? "sin usuario"}.`,
    );
  }
  return { id: data.user.id, email, password, fullName: options.fullName };
}

/**
 * Invita a un email como lo hará C-07: con `data.full_name` y `redirectTo`. El
 * usuario queda sin contraseña ni email confirmado hasta que acepta.
 */
export async function inviteUser(
  admin: SupabaseClient,
  invitation: { email: string; fullName: string; redirectTo: string },
): Promise<{ id: string }> {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(
    invitation.email,
    {
      data: { full_name: invitation.fullName },
      redirectTo: invitation.redirectTo,
    },
  );
  if (error !== null || data.user === null) {
    throw new Error(
      `No se pudo invitar a ${invitation.email}: ${error?.message ?? "sin usuario"}.`,
    );
  }
  return { id: data.user.id };
}

/** Borra un usuario. Si ya no existe no es un error (la limpieza puede repetirse). */
export async function deleteUser(
  admin: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error !== null && error.status !== 404) {
    throw new Error(`No se pudo borrar el usuario ${id}: ${error.message}.`);
  }
}

/** URL y clave publicable del Supabase local, para los tests que hablan HTTP directo. */
export function supabaseEnv(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  publishableKey: string;
} {
  assertLocalTarget(env);
  return {
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL", env).replace(/\/+$/, ""),
    publishableKey: requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", env),
  };
}

const USERS_PAGE_SIZE = 200;
const USERS_MAX_PAGES = 25;

/** Busca un usuario por email con la API admin (no hay filtro por email: recorre las páginas). */
export async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= USERS_MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: USERS_PAGE_SIZE,
    });
    if (error !== null) {
      throw new Error(`No se pudo listar usuarios: ${error.message}.`);
    }
    const match = data.users.find(
      (user) => user.email?.toLowerCase() === wanted,
    );
    if (match !== undefined) return { id: match.id, email: wanted };
    if (data.users.length < USERS_PAGE_SIZE) return null;
  }
  return null;
}
