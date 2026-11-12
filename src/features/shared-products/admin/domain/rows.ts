import { z } from "zod";

// Lo que devuelven las RPCs `admin_*`, pasado a la forma de la pantalla. Cada fila
// se lee con un `z.object`, que descarta toda columna que no declara: aunque la
// base mandara un id o un nombre de organización, no llega a la pantalla (spec
// "Revisión del super-admin sin saber qué comercio votó"). Y `source` tampoco
// existe acá: el admin no la necesita. Una fila con otra forma lanza: es un bug.
// Módulo puro.

const queueRowSchema = z.object({
  barcode_norm: z.string(),
  barcode_key: z.string(),
  eligibility: z.string(),
  organization_count: z.number().int(),
  proposed_names: z.array(z.string()),
  proposed_brands: z.array(z.string()),
  has_similar_names: z.boolean(),
  first_vote_at: z.string(),
});

export type QueueItem = {
  readonly barcode: string;
  readonly barcodeKey: string;
  readonly eligibility: string;
  /** CANTIDAD de comercios que votaron; nunca cuáles. */
  readonly organizationCount: number;
  readonly proposedNames: readonly string[];
  readonly proposedBrands: readonly string[];
  readonly hasSimilarNames: boolean;
  readonly firstVoteAt: string;
};

export function parseQueueRows(data: unknown): QueueItem[] {
  if (data === null) return [];
  return z
    .array(queueRowSchema)
    .parse(data)
    .map((row) => ({
      barcode: row.barcode_norm,
      barcodeKey: row.barcode_key,
      eligibility: row.eligibility,
      organizationCount: row.organization_count,
      proposedNames: row.proposed_names,
      proposedBrands: row.proposed_brands,
      hasSimilarNames: row.has_similar_names,
      firstVoteAt: row.first_vote_at,
    }));
}

const entryRowSchema = z.object({
  barcode_norm: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  presentation: z.string().nullable(),
  status: z.enum(["active", "retired"]),
});

export type SharedProductEntry = {
  readonly barcode: string;
  readonly name: string;
  readonly brand: string | null;
  readonly presentation: string | null;
  readonly status: "active" | "retired";
};

export function parseEntryRows(data: unknown): SharedProductEntry[] {
  if (data === null) return [];
  return z
    .array(entryRowSchema)
    .parse(data)
    .map((row) => ({
      barcode: row.barcode_norm,
      name: row.name,
      brand: row.brand,
      presentation: row.presentation,
      status: row.status,
    }));
}
