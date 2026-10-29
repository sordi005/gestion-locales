import { formatLocalDateTime } from "@/shared/lib/dates";
import { formatArs, toCents } from "@/shared/lib/money";

// Historial de precios de la ficha (design D16, últimos 20). Puro: arma las
// etiquetas; la lectura de `price_changes` y de `profiles` es de `queries.ts`.

// Forma de la fila de `price_changes` que lee la ficha (ver `__tests__/db-types.test.ts`).
type PriceChangeRow = {
  readonly id: string;
  readonly old_price: number | null;
  readonly new_price: number;
  readonly source: string;
  readonly changed_by: string | null;
  readonly changed_at: string;
};

/** Columnas del historial: explícitas, sin `*`. */
export const PRICE_CHANGE_COLUMNS =
  "id, old_price, new_price, source, changed_by, changed_at";

/** Cuántos cambios muestra la ficha; el historial completo es de C-53. */
export const PRICE_HISTORY_LIMIT = 20;

/** Los cinco orígenes que acepta el CHECK de `price_changes.source`. */
export const PRICE_SOURCE_LABELS: Readonly<Record<string, string>> = {
  manual: "Cambio manual",
  quick_create: "Alta rápida",
  bulk_update: "Actualización masiva",
  bulk_revert: "Reversión",
  catalog_import: "Importación",
};

const UNKNOWN_SOURCE_LABEL = "Otro origen";

export function priceSourceLabel(source: string): string {
  return PRICE_SOURCE_LABELS[source] ?? UNKNOWN_SOURCE_LABEL;
}

/**
 * Quién hizo el cambio: el nombre del perfil si se pudo leer; "Otra persona"
 * si RLS no deja ver ese perfil (o no tiene nombre); "Sistema" si no hubo
 * usuario.
 */
export function historyActorLabel(
  changedBy: string | null,
  visibleName: string | null | undefined,
): string {
  if (changedBy === null) return "Sistema";
  const name = visibleName?.trim();
  return name ? name : "Otra persona";
}

export type PriceHistoryEntry = {
  readonly id: string;
  readonly changedAtLabel: string;
  /** "—" si el producto no tenía precio. */
  readonly oldPriceLabel: string;
  readonly newPriceLabel: string;
  readonly sourceLabel: string;
  readonly actorLabel: string;
};

const NO_OLD_PRICE_LABEL = "—";

/** DTO de una fila del historial; `namesById` son los perfiles que RLS dejó leer. */
export function toPriceHistoryEntry(
  row: Pick<
    PriceChangeRow,
    "id" | "old_price" | "new_price" | "source" | "changed_by" | "changed_at"
  >,
  namesById: ReadonlyMap<string, string>,
): PriceHistoryEntry {
  return {
    id: row.id,
    changedAtLabel: formatLocalDateTime(new Date(row.changed_at)),
    oldPriceLabel:
      row.old_price === null
        ? NO_OLD_PRICE_LABEL
        : formatArs(toCents(row.old_price)),
    newPriceLabel: formatArs(toCents(row.new_price)),
    sourceLabel: priceSourceLabel(row.source),
    actorLabel: historyActorLabel(
      row.changed_by,
      row.changed_by === null ? null : namesById.get(row.changed_by),
    ),
  };
}
