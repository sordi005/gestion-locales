"use client";

import { useMemo, useRef, useState, useTransition } from "react";

import type { Role } from "@/features/tenancy";
import type { Scan } from "@/shared/lib/scanner/scan-result";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Input } from "@/shared/ui/input";
import { Scanner } from "@/shared/ui/scanner";

import { useCatalogCache } from "../cache";
import { catalogPath } from "../components/catalog-href";
import type { ProductBasicView } from "../domain/product-view";
import { PRODUCTS_SCREEN_MESSAGES as TEXT } from "./domain/messages";
import type {
  QuickCreateOutcome,
  SetPriceOutcome,
} from "./domain/submit-quick-create";
import { toBasicView } from "./domain/to-basic-view";
import { ProductCard } from "./product-card";
import { QuickCreateProduct } from "./quick-create-product";
import { useScanResolver } from "./use-scan-resolver";

// Pantalla "Productos" del local (C-12, design D1 y D11): se escanea o se busca por
// nombre; si el código no está, se da de alta con la hoja; si el producto no tiene
// precio, se le pone el primero. Los tres roles la usan; el empleado no edita datos.

type ProductsScreenProps = {
  readonly orgId: string;
  readonly role: Role;
  /** Falso con la organización suspendida: solo lectura. */
  readonly writable: boolean;
};

type Selected = {
  readonly product: ProductBasicView;
  /** `null` cuando se eligió por nombre. */
  readonly scan: Scan | null;
  readonly notice: string | null;
};

type SheetState = { readonly id: number } & (
  | { readonly mode: "create"; readonly scan: Scan }
  | {
      readonly mode: "price";
      /** `null` si el producto se eligió por nombre. */
      readonly scan: Scan | null;
      readonly product: ProductBasicView;
    }
);

type SheetDraft =
  | { readonly mode: "create"; readonly scan: Scan }
  | {
      readonly mode: "price";
      readonly scan: Scan | null;
      readonly product: ProductBasicView;
    };

const ADMIN_ROLES: readonly Role[] = ["owner", "manager"];

export function ProductsScreen({ orgId, role, writable }: ProductsScreenProps) {
  const { status, search } = useCatalogCache();
  const resolve = useScanResolver(orgId);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  // Solo la última lectura manda: una resolución vieja que llega tarde se ignora.
  const scanSeq = useRef(0);
  // La hoja vigente: lo que termina una hoja cerrada o reemplazada no cuenta.
  const sheetCounter = useRef(0);
  const activeSheet = useRef<number | null>(null);

  function openSheet(draft: SheetDraft) {
    // Una lectura en vuelo que llegue después ya no manda: la persona siguió con otra cosa.
    scanSeq.current += 1;
    sheetCounter.current += 1;
    activeSheet.current = sheetCounter.current;
    setSheet({ ...draft, id: sheetCounter.current });
  }

  function closeSheet() {
    activeSheet.current = null;
    setSheet(null);
  }

  function handleScan(scan: Scan) {
    setMessage(null);
    scanSeq.current += 1;
    const seq = scanSeq.current;
    startTransition(async () => {
      try {
        const resolution = await resolve(scan);
        if (seq !== scanSeq.current || activeSheet.current !== null) return;
        if (resolution.kind === "found") {
          setSelected({ product: resolution.product, scan, notice: null });
        } else if (writable) {
          setSelected(null);
          openSheet({ mode: "create", scan });
        } else {
          setSelected(null);
          setMessage(TEXT.notFoundCode);
        }
      } catch {
        if (seq === scanSeq.current && activeSheet.current === null) {
          setMessage(TEXT.checkFailed);
        }
      }
    });
  }

  function handleDone(
    sheetId: number,
    outcome: QuickCreateOutcome | SetPriceOutcome,
  ) {
    if (activeSheet.current !== sheetId) return;
    closeSheet();
    setMessage(null);
    setSelected({
      product: outcome.product,
      scan: outcome.scan,
      notice: outcome.notice ?? null,
    });
  }

  const trimmed = query.trim();
  const results = useMemo(
    () => (trimmed === "" ? [] : search(query)),
    [trimmed, query, search],
  );

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">{TEXT.title}</h1>

      {writable ? null : (
        <Alert>
          <AlertDescription>{TEXT.suspended}</AlertDescription>
        </Alert>
      )}

      <Scanner.Root
        className="flex flex-col gap-3"
        enabled={sheet === null}
        onScan={handleScan}
      >
        <Scanner.Input />
        <Scanner.Status />
        <Scanner.Camera mode="single" />
      </Scanner.Root>

      <div aria-live="polite" className="min-h-5 text-sm">
        {pending ? (
          <p className="text-muted-foreground">{TEXT.searching}</p>
        ) : null}
        {message === null ? null : (
          <p className="text-destructive">{message}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="products-search" className="text-sm font-medium">
          {TEXT.searchLabel}
        </label>
        <Input
          id="products-search"
          type="search"
          autoComplete="off"
          placeholder={TEXT.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div aria-live="polite">
          {trimmed === "" ? null : results.length > 0 ? (
            <ul aria-label={TEXT.results} className="flex flex-col gap-1">
              {results.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col rounded-lg border px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => {
                      // Elegir a mano pisa cualquier lectura que todavía esté en vuelo.
                      scanSeq.current += 1;
                      setMessage(null);
                      setSelected({
                        product: toBasicView(product),
                        scan: null,
                        notice: null,
                      });
                    }}
                  >
                    <span className="font-medium">{product.name}</span>
                    {product.brand === null ? null : (
                      <span className="text-sm text-muted-foreground">
                        {product.brand}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {status === "loading" ? TEXT.loadingCatalog : TEXT.noResults}
            </p>
          )}
        </div>
      </div>

      {selected === null ? null : (
        <ProductCard
          product={selected.product}
          code={selected.scan?.raw ?? null}
          writable={writable}
          recordHref={
            ADMIN_ROLES.includes(role)
              ? `${catalogPath(orgId)}/${selected.product.id}`
              : null
          }
          notice={selected.notice}
          onSetPrice={() =>
            openSheet({
              mode: "price",
              scan: selected.scan,
              product: selected.product,
            })
          }
        />
      )}

      {sheet === null ? null : sheet.mode === "price" ? (
        <QuickCreateProduct
          key={sheet.id}
          orgId={orgId}
          scan={sheet.scan}
          origin="catalog"
          mode="price"
          product={sheet.product}
          open
          onDone={(outcome) => handleDone(sheet.id, outcome)}
          onCancel={closeSheet}
        />
      ) : (
        <QuickCreateProduct
          key={sheet.id}
          orgId={orgId}
          scan={sheet.scan}
          origin="catalog"
          open
          onDone={(outcome) => handleDone(sheet.id, outcome)}
          onCancel={closeSheet}
        />
      )}
    </div>
  );
}
