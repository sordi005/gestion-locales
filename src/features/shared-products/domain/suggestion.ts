import { z } from "zod";

// Lo que la base compartida le sugiere a un comercio (C-64, D2) y cómo se vuelve un
// precargado para el alta rápida (C-12). Módulo puro: nada de I/O. NUNCA lleva la
// fuente, las fechas ni un id: la RPC no los devuelve y el esquema descarta cualquier
// columna de más.

/** Las cuatro columnas de `lookup_shared_product`, validadas a la salida de la RPC. */
export const sharedProductSuggestionSchema = z.object({
  barcode_norm: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().nullable(),
  presentation: z.string().nullable(),
});

export type SharedProductSuggestion = z.infer<
  typeof sharedProductSuggestionSchema
>;

/** Una fila de la RPC como `SharedProductSuggestion`, o `null` si no calza con el contrato. */
export function parseSharedProductSuggestion(
  row: unknown,
): SharedProductSuggestion | null {
  const parsed = sharedProductSuggestionSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

/** Largo máximo del nombre de un producto del catálogo (C-08). */
const MAX_PRODUCT_NAME = 200;

/** Lo que precarga el alta rápida: nombre (editable) y marca. */
export type QuickCreateSuggestion = {
  readonly name: string;
  readonly brand: string | null;
};

/** Minúsculas y sin acentos, para comparar textos. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** Letra o número (con acentos): lo que pega una palabra con la de al lado. */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/** ¿`text` contiene `part` completa, sin pegarse a otras letras o números? ("50 g" no está en "150 g") */
function containsWhole(text: string, part: string): boolean {
  let from = text.indexOf(part);
  while (from !== -1) {
    const end = from + part.length;
    if (!isWordChar(text[from - 1]) && !isWordChar(text[end])) return true;
    from = text.indexOf(part, from + 1);
  }
  return false;
}

/**
 * Nombre de la base con la presentación agregada al final, salvo que ya esté dentro
 * del nombre (se compara sin acentos ni mayúsculas): "Alfajor X" + "50 g" →
 * "Alfajor X 50 g". Si con la presentación el nombre pasaría de 200 caracteres (el límite del
 * catálogo), se deja solo el nombre.
 */
export function toQuickCreateSuggestion(
  s: SharedProductSuggestion,
): QuickCreateSuggestion {
  const presentation = s.presentation?.trim() ?? "";
  const alreadyThere =
    presentation === "" || containsWhole(fold(s.name), fold(presentation));
  const withPresentation = `${s.name} ${presentation}`;
  const append = !alreadyThere && withPresentation.length <= MAX_PRODUCT_NAME;
  return {
    name: append ? withPresentation : s.name,
    brand: s.brand,
  };
}
