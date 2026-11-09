// Multiplicador `N*` de la caja (D12). Módulo puro.

/** Entero de 1 a 999 sin ceros a la izquierda, seguido de un único `*`. Solo dígitos ASCII. */
const MULTIPLIER_PREFIX = /^([1-9][0-9]{0,2})\*(?!\*)/;

export type MultiplierSplit = {
  /** `null` si el texto no empieza con un `N*` válido. */
  readonly multiplier: number | null;
  /** Lo que sigue al `N*`; el texto entero si no hay multiplicador. */
  readonly rest: string;
};

/**
 * Separa un prefijo `N*` (`N` entre 1 y 999) del resto. Un prefijo que no es un
 * multiplicador válido (`0*`, `1000*`, `03*`, `*`, `3**`) no se separa: el texto
 * llega entero a `normalizeBarcode`, que lo rechaza con `invalid_characters`.
 */
export function splitMultiplier(text: string): MultiplierSplit {
  const match = MULTIPLIER_PREFIX.exec(text);
  if (match === null) return { multiplier: null, rest: text };
  return {
    multiplier: Number(match[1]),
    rest: text.slice(match[0].length),
  };
}
