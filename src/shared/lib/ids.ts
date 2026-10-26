import { v7 } from "uuid";

/**
 * Opciones SOLO para tests determinísticos: en producción se omiten.
 * - `now`: instante en milisegundos Unix (lo que va en los primeros 48 bits).
 * - `random`: 16 bytes de azar fijo.
 */
export type NewSaleIdOptions = {
  now?: number;
  random?: Uint8Array;
};

/**
 * Id de venta: UUID versión 7 (RFC 9562) en minúsculas. Los primeros 48 bits son
 * el instante en milisegundos y el resto es azar criptográfico
 * (`crypto.getRandomValues`, disponible en el navegador y en Node).
 *
 * Lo genera el CLIENTE al abrir el carrito (RN-OF-01, DD-31) y es la llave de
 * idempotencia de `register_sale`: un reintento con el mismo id nunca duplica la
 * venta. Al empezar por el tiempo, los ids de un mismo dispositivo quedan en
 * orden de creación (bueno para el índice de `sales`).
 *
 * Es el único módulo de `src/shared/lib` que lee el reloj y el azar por su cuenta,
 * y el único que importa `uuid` (D12): si algún día se cambia la implementación,
 * no se toca a nadie más. Nunca `Math.random()`.
 *
 * OJO: la monotonía de `uuid` (dos ids en el mismo milisegundo salen ordenados)
 * vale SOLO cuando se llama `v7()` sin argumentos. Con cualquier objeto de
 * opciones, aunque sea `{}`, se ignora su estado interno. Por eso el caso normal
 * llama a `v7()` pelado y solo se pasan opciones cuando el test las inyecta.
 */
export function newSaleId(options?: NewSaleIdOptions): string {
  if (options?.now === undefined && options?.random === undefined) {
    return v7();
  }
  return v7({
    ...(options.now !== undefined && { msecs: options.now }),
    ...(options.random !== undefined && { random: options.random }),
  });
}

/** Versión 7 y variante RFC (`8`, `9`, `a` o `b`); sin distinguir mayúsculas. */
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Guard para validar el id que llega en un payload sin usar `any`. Es una regex
 * propia (no depende de `uuid`). Acepta mayúsculas: Postgres devuelve minúsculas,
 * pero un id puede venir tipeado o de otra fuente.
 */
export function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}
