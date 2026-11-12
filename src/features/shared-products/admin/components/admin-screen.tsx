import Link from "next/link";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

import { getSharedProduct, listSharedProductQueue } from "../actions";
import { adminHref } from "../paths";
import { EntryLookup } from "./entry-lookup";
import { QueueTable } from "./queue-table";
import { RunConsensusButton } from "./run-consensus-button";

/** Filas por página; se pide una más para saber si hay otra página. */
const PAGE_SIZE = 25;

type AdminBaseScreenProps = {
  /** Cursor de la cola de la URL (`?cursor=`), tal como llegó: lo valida la acción. */
  readonly cursor?: string;
  /** Código buscado de la URL (`?codigo=`), tal como llegó. */
  readonly barcode?: string;
};

/**
 * Pantalla de revisión de la base compartida (design D7): cola paginada, aprobar y
 * rechazar por fila, búsqueda de un código de la base para corregirlo, retirarlo
 * o reactivarlo, y el botón de la promoción. La guarda `requirePlatformAdmin()` la
 * llama la página; las acciones la vuelven a llamar.
 */
export async function AdminBaseScreen({
  cursor,
  barcode,
}: AdminBaseScreenProps) {
  const searched = barcode !== undefined && barcode.trim() !== "";
  const [queue, lookup] = await Promise.all([
    listSharedProductQueue({ limit: PAGE_SIZE + 1, cursor }),
    searched ? getSharedProduct({ barcode }) : Promise.resolve(null),
  ]);

  const items = queue.ok ? queue.value.slice(0, PAGE_SIZE) : [];
  const hasNext = queue.ok && queue.value.length > PAGE_SIZE;
  const lastKey = items.at(-1)?.barcodeKey;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Base de productos</h1>
          <p className="text-sm text-muted-foreground">
            Revisá los códigos que cargaron los comercios y corregí lo que ya
            está en la base compartida.
          </p>
        </div>
        <RunConsensusButton />
      </div>

      <section aria-labelledby="cola-titulo" className="flex flex-col gap-4">
        <h2 id="cola-titulo" className="text-lg font-semibold">
          Para revisar
        </h2>

        {queue.ok ? null : (
          <Alert variant="destructive">
            <AlertDescription>{queue.error.message}</AlertDescription>
          </Alert>
        )}

        {queue.ok && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay códigos para revisar.
          </p>
        ) : null}

        {items.length > 0 ? <QueueTable items={items} /> : null}

        {cursor !== undefined || hasNext ? (
          <nav
            aria-label="Paginación"
            className="flex items-center justify-between gap-3"
          >
            {cursor === undefined ? (
              <span />
            ) : (
              <Button asChild variant="outline">
                <Link href={adminHref({ barcode })}>Volver al principio</Link>
              </Button>
            )}
            {hasNext ? (
              <Button asChild variant="outline">
                <Link href={adminHref({ cursor: lastKey, barcode })}>
                  Siguiente
                </Link>
              </Button>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>

      <EntryLookup barcode={barcode} result={lookup} />
    </div>
  );
}
