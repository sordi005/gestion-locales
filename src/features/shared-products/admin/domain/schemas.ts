import { z } from "zod";

import { err, ok } from "@/shared/lib/result";

import { adminError } from "./errors";
import type { AdminFieldErrors, AdminResult } from "./errors";

// Esquemas Zod de toda entrada del admin (regla dura 3), con mensajes en
// castellano. Los límites son los de la tabla `shared_products` y de las RPCs.
// Un esquema es un `z.object`, que descarta las claves que no declara: una
// organización que llegara en el pedido nunca pasa. Módulo puro.

const MAX_NAME = 200;
const MAX_BRAND = 80;
const MAX_PRESENTATION = 40;
const MAX_REASON = 500;
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

const MESSAGES = {
  barcode: "El código tiene que tener solo números (hasta 14).",
  name: "Escribí el nombre.",
  nameTooLong: `El nombre puede tener hasta ${MAX_NAME} caracteres.`,
  brandTooLong: `La marca puede tener hasta ${MAX_BRAND} caracteres.`,
  presentationTooLong: `La presentación puede tener hasta ${MAX_PRESENTATION} caracteres.`,
  reason: `Escribí el motivo (hasta ${MAX_REASON} caracteres).`,
  limit: `El tamaño de página va de 1 a ${MAX_PAGE_SIZE}.`,
} as const;

/** Dígitos (1 a 14) con al menos uno distinto de cero: el mismo formato que la base. */
const barcode = z
  .string({ error: MESSAGES.barcode })
  .trim()
  .regex(/^[0-9]{1,14}$/, MESSAGES.barcode)
  .regex(/[1-9]/, MESSAGES.barcode);

/** Texto opcional: recortado, y vacío cuenta como no enviado. */
function optionalText(max: number, tooLong: string) {
  return z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((value) => (value === "" ? undefined : value));
}

const name = z
  .string({ error: MESSAGES.name })
  .trim()
  .min(1, MESSAGES.name)
  .max(MAX_NAME, MESSAGES.nameTooLong);

const reason = z
  .string({ error: MESSAGES.reason })
  .trim()
  .min(1, MESSAGES.reason)
  .max(MAX_REASON, MESSAGES.reason);

const productFields = {
  barcode,
  name,
  brand: optionalText(MAX_BRAND, MESSAGES.brandTooLong),
  presentation: optionalText(MAX_PRESENTATION, MESSAGES.presentationTooLong),
};

/** Aprobar (o reactivar) un código: nombre, marca y presentación editables. */
export const approveInputSchema = z.object(productFields);
export type ApproveInput = z.output<typeof approveInputSchema>;

/** Corregir una entrada que ya está en la base. */
export const updateInputSchema = z.object(productFields);
export type UpdateInput = z.output<typeof updateInputSchema>;

export const rejectInputSchema = z.object({ barcode, reason });
export type RejectInput = z.output<typeof rejectInputSchema>;

export const retireInputSchema = z.object({ barcode, reason });
export type RetireInput = z.output<typeof retireInputSchema>;

export const barcodeInputSchema = z.object({ barcode });
export type BarcodeInput = z.output<typeof barcodeInputSchema>;

/** Cola paginada por cursor: el último `barcode_key` visto. */
export const queueInputSchema = z.object({
  limit: z
    .number({ error: MESSAGES.limit })
    .int(MESSAGES.limit)
    .min(1, MESSAGES.limit)
    .max(MAX_PAGE_SIZE, MESSAGES.limit)
    .default(DEFAULT_PAGE_SIZE),
  cursor: z
    .string()
    .regex(/^[0-9]{1,14}$/, MESSAGES.barcode)
    .optional(),
});
export type QueueInput = z.output<typeof queueInputSchema>;

/** Valida con Zod; el primer mensaje de cada campo sale como error por campo (`SP-A01`). */
export function parseAdminInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): AdminResult<z.output<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return ok(parsed.data);

  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String).join(".");
    if (!(path in fieldErrors)) fieldErrors[path] = issue.message;
  }
  const frozen: AdminFieldErrors = fieldErrors;
  return err(adminError("SP-A01", { fieldErrors: frozen }));
}
