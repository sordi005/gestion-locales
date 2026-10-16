// Guarda de destino de los E2E: crean, invitan y borran usuarios con la secret key
// y mandan emails de verdad, así que solo pueden correr contra Supabase y Mailpit
// locales. Si `.env.local` (o el entorno de la terminal) apuntara a staging, todo
// se corta antes de tocar nada. Es puro: la usan `globalSetup` y cada helper que
// habla con Supabase (defensa en profundidad, porque los helpers también corren
// fuera de `globalSetup`).

/** Variables que tienen que apuntar a esta máquina, en el orden en que se informan. */
const LOCAL_ONLY_VARIABLES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "MAILPIT_URL",
] as const;

// `URL.hostname` devuelve IPv6 entre corchetes. Lista fija a propósito: no se
// acepta `0.0.0.0` ni el resto de `127.0.0.0/8`, solo lo que usa `supabase start`.
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
]);

/**
 * ¿El host de la URL es exactamente `127.0.0.1`, `localhost` o `[::1]`? Se mira el
 * host que el parser de URL resuelve de verdad (`http://127.0.0.1@otro.example`
 * apunta a `otro.example`), nunca el texto. Una URL mal formada no es local.
 */
export function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(value.trim()).hostname);
  } catch {
    return false;
  }
}

/**
 * Nombres de las variables definidas que no apuntan a un destino local. Lo que
 * falta o está vacío no cuenta: de eso se encarga el chequeo de faltantes.
 */
export function nonLocalVariables(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  return LOCAL_ONLY_VARIABLES.filter((name) => {
    const value = env[name];
    return value !== undefined && value.trim() !== "" && !isLoopbackUrl(value);
  });
}

/** El mensaje nombra las variables, nunca sus valores (la URL de staging y las claves no se repiten). */
export function nonLocalTargetMessage(names: readonly string[]): string {
  return `${names.join(" y ")} no apunta${names.length > 1 ? "n" : ""} a una dirección local (127.0.0.1, localhost o [::1]). Los E2E crean, invitan y borran usuarios con la secret key y mandan emails: solo corren contra Supabase local, nunca contra staging ni producción. Corregí .env.local o el entorno de la terminal (pnpm exec supabase start y scripts/ci/local-supabase-env.ts).`;
}

/** Lanza si alguna variable de destino apunta fuera de esta máquina. */
export function assertLocalTarget(
  env: Readonly<Record<string, string | undefined>>,
): void {
  const names = nonLocalVariables(env);
  if (names.length > 0) throw new Error(nonLocalTargetMessage(names));
}
