import { AsyncLocalStorage } from "node:async_hooks";

import { err } from "@/shared/lib/result";

import { dbErrorLogFields, mapCatalogDbError } from "./domain/db-errors";
import type { CatalogResult } from "./domain/errors";

// Cómo se convierte una falla de la base o una excepción en la respuesta de una
// acción. Nunca devuelve ni loguea texto de Postgres ni datos de la persona: la
// respuesta es un `CatalogError` con mensaje propio y el log lleva solo la acción,
// el tipo de error, el código y el nombre de la restricción (spec "Errores de la
// base traducidos", CA-E10).

/**
 * La acción que está corriendo, para que un `CA-E10` logueado desde una mutación
 * diga de qué acción vino sin tener que pasarla por cada función.
 */
const currentAction = new AsyncLocalStorage<string>();

/** Corre `run` anotando `action` como la acción en curso (lo usa el envoltorio). */
export function withActionName<T>(action: string, run: () => Promise<T>) {
  return currentAction.run(action, run);
}

/**
 * Loguea lo único que se puede loguear de un error: acción, tipo de error, código
 * y restricción. Nunca el mensaje, los detalles ni datos de la persona.
 */
export function logCatalogFailure(context: string, error: unknown): void {
  console.error(`[catalog] ${context}`, {
    action: currentAction.getStore() ?? "unknown",
    ...dbErrorLogFields(error),
  });
}

/**
 * Traduce un error de PostgREST. Lo que no se reconoce (`CA-E10`) se loguea con
 * código y restricción solamente.
 */
export function dbFailure(
  error: unknown,
  context = "escritura fallida",
): CatalogResult<never> {
  const mapped = mapCatalogDbError(error);
  if (mapped.code === "CA-E10") logCatalogFailure(context, error);
  return err(mapped);
}
