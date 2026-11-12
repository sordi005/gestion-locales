"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { requirePlatformAdmin } from "@/features/tenancy/server";
import { createClient } from "@/shared/db/server";

import type { AdminResult } from "./domain/errors";
import { parseEntryRows, parseQueueRows } from "./domain/rows";
import type { QueueItem, SharedProductEntry } from "./domain/rows";
import {
  approveInputSchema,
  barcodeInputSchema,
  queueInputSchema,
  rejectInputSchema,
  retireInputSchema,
  updateInputSchema,
} from "./domain/schemas";
import { ADMIN_PATH } from "./paths";
import { runAdminRpc } from "./run-admin-rpc";

// Acciones del super-admin sobre la base compartida (design D7): una por RPC
// `admin_*`. Cada una abre con `requirePlatformAdmin()`, escrita LITERAL en su
// cuerpo (la convención de guardas la busca ahí) y antes de abrir la base; sigue
// con `runAdminRpc`: Zod, RPC, traducción de errores. Reciben objetos
// serializables y devuelven un `AdminResult`: nunca texto de Postgres. Las RPCs
// vuelven a exigir `is_platform_admin()` (si no, 42501): la guarda es la primera
// capa, no la única. Reactivar una entrada retirada es aprobarla de nuevo.

/** Las escrituras refrescan la pantalla (cola y búsqueda). */
function refreshScreen(): void {
  revalidatePath(ADMIN_PATH);
}

export async function listSharedProductQueue(
  input: unknown,
): Promise<AdminResult<QueueItem[]>> {
  await requirePlatformAdmin();
  const client = await createClient();
  return runAdminRpc({
    schema: queueInputSchema,
    input,
    call: ({ limit, cursor }) =>
      client.rpc("admin_list_shared_product_queue", {
        p_limit: limit,
        p_cursor: cursor,
      }),
    map: parseQueueRows,
  });
}

/** Una entrada de la base por código (la búsqueda para corregir, retirar o reactivar). */
export async function getSharedProduct(
  input: unknown,
): Promise<AdminResult<SharedProductEntry | null>> {
  await requirePlatformAdmin();
  const client = await createClient();
  return runAdminRpc({
    schema: barcodeInputSchema,
    input,
    call: ({ barcode }) =>
      client.rpc("admin_get_shared_product", { p_barcode: barcode }),
    map: (data) => parseEntryRows(data)[0] ?? null,
  });
}

/** Aprueba un código de la cola con el nombre elegido; sobre uno retirado, lo reactiva. */
export async function approveSharedProduct(
  input: unknown,
): Promise<AdminResult<null>> {
  await requirePlatformAdmin();
  const client = await createClient();
  const result = await runAdminRpc({
    schema: approveInputSchema,
    input,
    call: ({ barcode, name, brand, presentation }) =>
      client.rpc("admin_approve_shared_product", {
        p_barcode: barcode,
        p_name: name,
        p_brand: brand,
        p_presentation: presentation,
      }),
    map: () => null,
  });
  if (result.ok) refreshScreen();
  return result;
}

export async function rejectSharedProduct(
  input: unknown,
): Promise<AdminResult<null>> {
  await requirePlatformAdmin();
  const client = await createClient();
  const result = await runAdminRpc({
    schema: rejectInputSchema,
    input,
    call: ({ barcode, reason }) =>
      client.rpc("admin_reject_shared_product_submission", {
        p_barcode: barcode,
        p_reason: reason,
      }),
    map: () => null,
  });
  if (result.ok) refreshScreen();
  return result;
}

export async function updateSharedProduct(
  input: unknown,
): Promise<AdminResult<null>> {
  await requirePlatformAdmin();
  const client = await createClient();
  const result = await runAdminRpc({
    schema: updateInputSchema,
    input,
    call: ({ barcode, name, brand, presentation }) =>
      client.rpc("admin_update_shared_product", {
        p_barcode: barcode,
        p_name: name,
        p_brand: brand,
        p_presentation: presentation,
      }),
    map: () => null,
  });
  if (result.ok) refreshScreen();
  return result;
}

export async function retireSharedProduct(
  input: unknown,
): Promise<AdminResult<null>> {
  await requirePlatformAdmin();
  const client = await createClient();
  const result = await runAdminRpc({
    schema: retireInputSchema,
    input,
    call: ({ barcode, reason }) =>
      client.rpc("admin_retire_shared_product", {
        p_barcode: barcode,
        p_reason: reason,
      }),
    map: () => null,
  });
  if (result.ok) refreshScreen();
  return result;
}

/**
 * Corre la promoción por consenso a mano; devuelve cuántos códigos promovió, o
 * `null` si la corrida se salteó porque otra (el cron u otro admin) tenía el
 * candado: no es lo mismo que 0 ("corrió y no había nada").
 */
export async function runSharedProductConsensus(): Promise<
  AdminResult<number | null>
> {
  await requirePlatformAdmin();
  const client = await createClient();
  const result = await runAdminRpc({
    schema: z.object({}),
    input: {},
    call: () => client.rpc("admin_run_shared_product_consensus"),
    map: (data) => {
      if (data === null) return null;
      if (typeof data !== "number") {
        throw new TypeError("la promoción no devolvió un número");
      }
      return data;
    },
  });
  if (result.ok) refreshScreen();
  return result;
}
