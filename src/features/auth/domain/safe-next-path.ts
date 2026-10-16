import {
  AUTH_LINKS_PREFIX,
  HOME_PATH,
  LOGIN_PATH,
  PASSWORD_SETUP_PATH,
  RECOVERY_PATH,
} from "./auth-paths";

const FALLBACK = HOME_PATH;

// Rutas del flujo de auth: volver a ellas después de ingresar genera bucles.
// Se comparan por segmento completo (`/authors` no es `/auth`).
const AUTH_ROUTES = [
  LOGIN_PATH,
  RECOVERY_PATH,
  PASSWORD_SETUP_PATH,
  AUTH_LINKS_PREFIX,
];

// Solo para resolver rutas relativas (puntos, `..`): no sale de esta función.
const RESOLUTION_BASE = "http://internal.invalid";

// Solo ASCII imprimible, sin espacio (0x21 a 0x7E). El destino termina en un
// header `Location` (`redirect()`): un carácter fuera de ese rango (control,
// espacio, NBSP, U+2028, letras con tilde, ideogramas...) lo rompe en Node
// (`ERR_INVALID_CHAR` → 500 después de un ingreso exitoso) o cambia lo que el
// navegador entiende. Lo legítimo (rutas de la app y los `next` que arma el
// proxy) ya viene codificado con `%xx`, o sea en ASCII.
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

function isAuthPath(pathname: string): boolean {
  return AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * Filtra un destino tomado de la URL (`?next=`). Solo deja pasar rutas internas
 * que empiezan con UNA sola `/`; todo lo demás vuelve a `/`:
 * - valores que no son texto, vacíos o sin `/` inicial (esquemas, `evil.example`);
 * - `//host` y `/\host` (el navegador los toma como otro origen);
 * - barras invertidas y todo lo que no sea ASCII imprimible: controles (el
 *   navegador elimina tab y salto de línea, así que `/\t/host` se convertiría
 *   en `//host`), espacios y letras fuera de ASCII (`/€`, `/ñ`), que rompen el
 *   header de la redirección (falla cerrado);
 * - las rutas de auth, también escondidas con `..` o con `%xx`, para no armar
 *   bucles ni redirigir a la pantalla de ingreso desde el ingreso.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return FALLBACK;
  if (!value.startsWith("/") || value.startsWith("//")) return FALLBACK;
  if (value.includes("\\") || !PRINTABLE_ASCII.test(value)) return FALLBACK;

  try {
    const { pathname } = new URL(value, RESOLUTION_BASE);
    if (isAuthPath(decodeURIComponent(pathname))) return FALLBACK;
  } catch {
    // URL imposible de resolver o `%xx` mal formado: no es un destino confiable.
    return FALLBACK;
  }

  return value;
}
