"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { FormEvent } from "react";

import type { Cents, QuantityMilli } from "@/shared/lib/money";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { MoneyInput } from "@/shared/ui/money-input";
import type { MoneyInputState } from "@/shared/ui/money-input";

import { createProduct, updateProduct } from "../actions";
import { CATALOG_ERROR_MESSAGES } from "../domain/errors";
import type { CatalogError } from "../domain/errors";
import { costBasisLabel, resolveProductCost } from "../domain/cost";
import type { CostSource, ProductUnit } from "../domain/product-view";
import { warningsToSearch } from "../domain/warnings-param";
import type { MinStockEntry, OptionDto } from "../dto";
import { catalogPath } from "./catalog-href";
import { FieldError, fieldInvalidProps } from "./field-error";
import { MarginSummary } from "./margin-summary";
import { formatQuantityText, parseMinStockText } from "./quantity-text";
import { SelectField } from "./select-field";

const MAX_BARCODE_ROWS = 20;
/** `Select` no admite un valor vacío: "ninguno" es este centinela. */
const NONE = "none";
const UNIT_OPTIONS = [
  { value: "unit", label: "Por unidad" },
  { value: "kg", label: "Por kilo" },
] as const;
const INVALID_QUANTITY = "Escribí una cantidad, por ejemplo 6 o 1,5.";

/** El producto que se edita: solo lo que el formulario necesita (nunca una fila). */
export type ProductFormProduct = {
  readonly id: string;
  readonly name: string;
  readonly brand: string | null;
  readonly categoryId: string | null;
  readonly unit: ProductUnit;
  readonly tracksStock: boolean;
  readonly tracksExpiry: boolean;
  readonly referenceCostCents: Cents | null;
  readonly referenceCostSource: CostSource | null;
  readonly preferredSupplierId: string | null;
};

type ProductFormProps = {
  readonly orgId: string;
  /** Falso con la organización suspendida: se ve todo, no se puede guardar. */
  readonly writable: boolean;
  readonly categories: readonly OptionDto[];
  readonly suppliers: readonly OptionDto[];
  /** Un renglón por local de la persona (con su mínimo actual o `null`). */
  readonly minStocks: readonly MinStockEntry[];
  /** Con producto, es la edición; sin producto, el alta. */
  readonly product?: ProductFormProduct;
};

type FormState = {
  name: string;
  brand: string;
  categoryId: string;
  unit: ProductUnit;
  tracksStock: boolean;
  tracksExpiry: boolean;
  salePriceCents: Cents | null;
  referenceCostCents: Cents | null;
  supplierId: string;
  barcodes: string[];
  minStocks: Record<string, string>;
};

type Feedback = { readonly kind: "none" } | { readonly kind: "saved" };

/** Los dos campos de dinero del formulario (la clave es la del error del servidor). */
type MoneyField = "salePriceCents" | "referenceCostCents";

/**
 * Lo que la ficha mostraba al abrirse (o al guardar por última vez): el servidor
 * escribe solo lo que la persona cambió respecto de esto, así un valor viejo del
 * formulario no pisa lo que otra persona editó mientras tanto.
 */
type LoadedSnapshot = {
  name: string;
  brand: string | null;
  categoryId: string | null;
  unit: ProductUnit;
  tracksStock: boolean;
  tracksExpiry: boolean;
  referenceCostCents: Cents | null;
  preferredSupplierId: string | null;
  minStocks: Record<string, QuantityMilli | null>;
};

/** Los mínimos por local como el servidor los tiene (`null`: sin mínimo). */
type MinStockValues = Record<string, QuantityMilli | null>;

function minStockValues(minStocks: readonly MinStockEntry[]): MinStockValues {
  return Object.fromEntries(
    minStocks.map((entry) => [entry.locationId, entry.minStockMilli]),
  );
}

function loadedSnapshot(
  product: ProductFormProduct | undefined,
  minStocks: MinStockValues,
): LoadedSnapshot | null {
  if (product === undefined) return null;
  return {
    name: product.name,
    brand: product.brand,
    categoryId: product.categoryId,
    unit: product.unit,
    tracksStock: product.tracksStock,
    tracksExpiry: product.tracksExpiry,
    referenceCostCents: product.referenceCostCents,
    preferredSupplierId: product.preferredSupplierId,
    minStocks,
  };
}

/** Una copia sin esa clave. */
function withoutKey(
  record: Readonly<Record<string, string>>,
  key: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).filter(([current]) => current !== key),
  );
}

const BARCODE_ERROR_KEY = /^barcodes\.(\d+)$/;

/**
 * El servidor numera los códigos de la lista que recibió (sin los renglones en
 * blanco): `barcodes.<i>` se vuelve a llevar al renglón de la pantalla.
 */
function remapBarcodeKey(key: string, sentRows: readonly number[]): string {
  const match = BARCODE_ERROR_KEY.exec(key);
  if (match === null) return key;
  const sent = Number(match[1]);
  return `barcodes.${sentRows[sent] ?? sent}`;
}

function initialState(
  product: ProductFormProduct | undefined,
  minStocks: MinStockValues,
): FormState {
  return {
    name: product?.name ?? "",
    brand: product?.brand ?? "",
    categoryId: product?.categoryId ?? NONE,
    unit: product?.unit ?? "unit",
    tracksStock: product?.tracksStock ?? true,
    tracksExpiry: product?.tracksExpiry ?? true,
    salePriceCents: null,
    referenceCostCents: product?.referenceCostCents ?? null,
    supplierId: product?.preferredSupplierId ?? NONE,
    barcodes: [""],
    minStocks: Object.fromEntries(
      Object.entries(minStocks).map(([locationId, milli]) => [
        locationId,
        milli === null ? "" : formatQuantityText(milli),
      ]),
    ),
  };
}

type ParsedMinStocks =
  | { readonly ok: true; readonly values: Record<string, QuantityMilli | null> }
  | { readonly ok: false; readonly errors: Record<string, string> };

/** Lee los mínimos escritos; los que no son una cantidad vuelven como error de su campo. */
function parseMinStocks(state: FormState): ParsedMinStocks {
  if (!state.tracksStock) return { ok: true, values: {} };
  const values: Record<string, QuantityMilli | null> = {};
  const errors: Record<string, string> = {};
  for (const [locationId, text] of Object.entries(state.minStocks)) {
    const parsed = parseMinStockText(text);
    if (parsed.ok) values[locationId] = parsed.value;
    else errors[`minStocks.${locationId}`] = INVALID_QUANTITY;
  }
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, values };
}

/**
 * Formulario del producto: alta (sin `product`) y edición de los datos. Las
 * acciones se llaman dentro de `startTransition`, así que un `notFound()` de la
 * guarda lo atiende el límite de Next y no una excepción suelta. El margen y el
 * aviso de "por debajo del costo" se calculan en vivo y nunca bloquean "Guardar".
 * El precio de un producto existente se cambia aparte (`PriceChangePanel`) y los
 * códigos también (`BarcodeList`).
 */
export function ProductForm({
  orgId,
  writable,
  categories,
  suppliers,
  minStocks,
  product,
}: ProductFormProps) {
  const router = useRouter();
  const uid = useId();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState(() =>
    initialState(product, minStockValues(minStocks)),
  );
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({ kind: "none" });
  // Texto de dinero que no es un monto (clave → motivo): no se guarda como "sin monto".
  const [invalidMoney, setInvalidMoney] = useState<
    Readonly<Record<string, string>>
  >({});
  const [loaded, setLoaded] = useState(() =>
    loadedSnapshot(product, minStockValues(minStocks)),
  );
  // El producto como el servidor lo devolvió la última vez (al abrir, o al guardar).
  const [saved, setSaved] = useState(product);
  // Tras crear, la pantalla se va a la ficha: el botón no deja crear otra vez.
  const [created, setCreated] = useState(false);

  const isEdit = product !== undefined;
  const id = (name: string) => `${uid}-${name}`;
  const errorOf = (key: string) => fieldErrors[key];

  const patch = (change: Partial<FormState>) =>
    setState((current) => ({ ...current, ...change }));

  // El vencimiento depende del stock: se deriva al dibujar, no se guarda aparte.
  const tracksExpiry = state.tracksStock && state.tracksExpiry;

  const cost = resolveProductCost({
    lastPurchaseCostCents: null,
    referenceCostCents: state.referenceCostCents,
  });
  const costSource: CostSource | null =
    saved !== undefined && state.referenceCostCents === saved.referenceCostCents
      ? saved.referenceCostSource
      : "manual";

  /** Un monto cambió: guarda los centavos, si el texto es válido y limpia su error. */
  function changeMoney(
    field: MoneyField,
    cents: Cents | null,
    input: MoneyInputState,
  ) {
    patch(
      field === "salePriceCents"
        ? { salePriceCents: cents }
        : { referenceCostCents: cents },
    );
    setInvalidMoney((current) => {
      const rest = withoutKey(current, field);
      return input.valid || input.message === undefined
        ? rest
        : { ...rest, [field]: input.message };
    });
    setFieldErrors((current) => withoutKey(current, field));
  }

  function showError(error: CatalogError, sentBarcodeRows: readonly number[]) {
    setFormError(error.message);
    setFieldErrors(
      Object.fromEntries(
        Object.entries(error.fieldErrors ?? {}).flatMap(
          ([key, message]): [string, string][] =>
            message === undefined
              ? []
              : [[remapBarcodeKey(key, sentBarcodeRows), message]],
        ),
      ),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback({ kind: "none" });
    setFormError(null);

    // Un texto de dinero que no es un monto no se guarda como "sin monto": se marca
    // con el motivo del propio campo (aunque no haya salido de él) y no se manda.
    const moneyErrors: Record<string, string> = {
      ...(isEdit || invalidMoney.salePriceCents === undefined
        ? {}
        : { salePriceCents: invalidMoney.salePriceCents }),
      ...(invalidMoney.referenceCostCents === undefined
        ? {}
        : { referenceCostCents: invalidMoney.referenceCostCents }),
    };
    const minimums = parseMinStocks(state);
    if (!minimums.ok || Object.keys(moneyErrors).length > 0) {
      setFieldErrors({
        ...moneyErrors,
        ...(minimums.ok ? {} : minimums.errors),
      });
      setFormError(CATALOG_ERROR_MESSAGES["CA-E01"]);
      const firstMoney = ["salePriceCents", "referenceCostCents"].find(
        (key) => key in moneyErrors,
      );
      if (firstMoney !== undefined) {
        document
          .getElementById(
            id(firstMoney === "salePriceCents" ? "price" : "cost"),
          )
          ?.focus();
      }
      return;
    }
    setFieldErrors({});

    const shared = {
      name: state.name,
      brand: state.brand.trim() === "" ? null : state.brand,
      categoryId: state.categoryId === NONE ? null : state.categoryId,
      unit: state.unit,
      tracksStock: state.tracksStock,
      tracksExpiry,
      referenceCostCents: state.referenceCostCents,
      preferredSupplierId: state.supplierId === NONE ? null : state.supplierId,
      minStocks: minimums.values,
    };

    // Los renglones en blanco no se mandan: se recuerda cuál era cada uno para
    // devolver los errores del servidor al renglón que los causó.
    const sentBarcodes = state.barcodes.flatMap((code, row) =>
      code.trim() === "" ? [] : [{ code, row }],
    );
    const sentRows = sentBarcodes.map((barcode) => barcode.row);

    startTransition(async () => {
      if (product === undefined || loaded === null) {
        const result = await createProduct(orgId, {
          ...shared,
          salePriceCents: state.salePriceCents,
          barcodes: sentBarcodes.map((barcode) => barcode.code),
        });
        if (!result.ok) {
          showError(result.error, sentRows);
          return;
        }
        // Creado: a la ficha, con los avisos (si hubo) para que los muestre ahí.
        setCreated(true);
        const { product: newProduct, warnings } = result.value;
        const search = warningsToSearch(warnings);
        router.push(
          `${catalogPath(orgId)}/${newProduct.id}${search === "" ? "" : `?${search}`}`,
        );
        return;
      }

      const result = await updateProduct(orgId, {
        ...shared,
        productId: product.id,
        loaded,
      });
      if (!result.ok) {
        showError(result.error, sentRows);
        return;
      }
      // Lo que devolvió el servidor pasa a ser lo visto y lo mostrado (no lo que la
      // persona escribió): conserva lo que otras personas cambiaron en el medio y el
      // próximo guardado compara contra eso. Los mínimos, que el servidor no
      // devuelve, son los que se guardaron.
      const savedProduct = result.value.product;
      const savedMinStocks = { ...loaded.minStocks, ...shared.minStocks };
      setSaved(savedProduct);
      setLoaded(loadedSnapshot(savedProduct, savedMinStocks));
      setState(initialState(savedProduct, savedMinStocks));
      setFeedback({ kind: "saved" });
      router.refresh();
    });
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-6"
      aria-label={isEdit ? "Datos del producto" : "Nuevo producto"}
    >
      <fieldset
        disabled={!writable}
        className="flex flex-col gap-6 border-0 p-0"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id("name")}>Nombre</Label>
          <Input
            id={id("name")}
            value={state.name}
            maxLength={200}
            aria-required="true"
            onChange={(event) => patch({ name: event.target.value })}
            {...fieldInvalidProps(id("name-error"), errorOf("name"))}
          />
          <FieldError id={id("name-error")} message={errorOf("name")} />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id("brand")}>Marca</Label>
            <Input
              id={id("brand")}
              value={state.brand}
              maxLength={80}
              onChange={(event) => patch({ brand: event.target.value })}
              {...fieldInvalidProps(id("brand-error"), errorOf("brand"))}
            />
            <FieldError id={id("brand-error")} message={errorOf("brand")} />
          </div>

          <SelectField
            id={id("category")}
            label="Categoría"
            value={state.categoryId}
            onValueChange={(value) => patch({ categoryId: value })}
            options={[
              { value: NONE, label: "Sin categoría" },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
            error={errorOf("categoryId")}
          />

          <SelectField
            id={id("unit")}
            label="Unidad"
            value={state.unit}
            onValueChange={(value) =>
              patch({ unit: value === "kg" ? "kg" : "unit" })
            }
            options={UNIT_OPTIONS}
            error={errorOf("unit")}
          />

          <SelectField
            id={id("supplier")}
            label="Proveedor habitual"
            value={state.supplierId}
            onValueChange={(value) => patch({ supplierId: value })}
            options={[
              { value: NONE, label: "Sin proveedor" },
              ...suppliers.map((s) => ({ value: s.id, label: s.name })),
            ]}
            error={errorOf("preferredSupplierId")}
          />
        </div>

        <fieldset className="flex flex-col gap-4 border-0 p-0">
          <legend className="mb-2 font-medium">
            {isEdit ? "Costo" : "Precio y costo"}
          </legend>
          <div className="grid gap-6 md:grid-cols-2">
            {isEdit ? null : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={id("price")}>Precio de venta</Label>
                <MoneyInput
                  id={id("price")}
                  value={state.salePriceCents}
                  onValueChange={(cents, input) =>
                    changeMoney("salePriceCents", cents, input)
                  }
                  error={errorOf("salePriceCents")}
                />
                {state.unit === "kg" ? (
                  <p className="text-sm text-muted-foreground">
                    Precio por kilo.
                  </p>
                ) : null}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id("cost")}>Costo de referencia</Label>
              <MoneyInput
                id={id("cost")}
                value={state.referenceCostCents}
                onValueChange={(cents, input) =>
                  changeMoney("referenceCostCents", cents, input)
                }
                error={errorOf("referenceCostCents")}
              />
              {cost.costCents === null ? null : (
                <p className="text-sm text-muted-foreground">
                  {costBasisLabel(cost.basis, costSource)}
                </p>
              )}
            </div>
          </div>
          {isEdit ? null : (
            <MarginSummary
              priceCents={state.salePriceCents}
              costCents={cost.costCents}
              unit={state.unit}
            />
          )}
        </fieldset>

        {isEdit ? null : (
          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="mb-2 font-medium">Códigos de barras</legend>
            {state.barcodes.map((code, index) => (
              <div key={index} className="flex flex-col gap-1.5">
                <Label htmlFor={id(`barcode-${index}`)}>
                  {`Código de barras ${index + 1}`}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id={id(`barcode-${index}`)}
                    value={code}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={64}
                    onChange={(event) =>
                      patch({
                        barcodes: state.barcodes.map((current, at) =>
                          at === index ? event.target.value : current,
                        ),
                      })
                    }
                    {...fieldInvalidProps(
                      id(`barcode-${index}-error`),
                      errorOf(`barcodes.${index}`),
                    )}
                  />
                  {state.barcodes.length > 1 ? (
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={`Quitar código ${index + 1}`}
                      onClick={() =>
                        patch({
                          barcodes: state.barcodes.filter(
                            (_, at) => at !== index,
                          ),
                        })
                      }
                    >
                      Quitar
                    </Button>
                  ) : null}
                </div>
                <FieldError
                  id={id(`barcode-${index}-error`)}
                  message={errorOf(`barcodes.${index}`)}
                />
              </div>
            ))}
            {state.barcodes.length < MAX_BARCODE_ROWS ? (
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => patch({ barcodes: [...state.barcodes, ""] })}
              >
                Agregar otro código
              </Button>
            ) : null}
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-4 border-0 p-0">
          <legend className="mb-2 font-medium">Stock</legend>
          <div className="flex items-center gap-2">
            <Checkbox
              id={id("tracks-stock")}
              checked={state.tracksStock}
              onCheckedChange={(checked) =>
                patch({ tracksStock: checked === true })
              }
            />
            <Label htmlFor={id("tracks-stock")}>Controla stock</Label>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Checkbox
                id={id("tracks-expiry")}
                checked={tracksExpiry}
                disabled={!state.tracksStock}
                aria-describedby={
                  state.tracksStock ? undefined : id("tracks-expiry-hint")
                }
                onCheckedChange={(checked) =>
                  patch({ tracksExpiry: checked === true })
                }
              />
              <Label htmlFor={id("tracks-expiry")}>Controla vencimientos</Label>
            </div>
            {state.tracksStock ? null : (
              <p
                id={id("tracks-expiry-hint")}
                className="text-sm text-muted-foreground"
              >
                Para controlar el vencimiento tiene que controlar el stock.
              </p>
            )}
            <FieldError
              id={id("tracks-expiry-error")}
              message={errorOf("tracksExpiry")}
            />
          </div>

          {state.tracksStock ? (
            <div className="grid gap-4 md:grid-cols-2">
              {minStocks.map((entry) => {
                const key = `minStocks.${entry.locationId}`;
                return (
                  <div key={entry.locationId} className="flex flex-col gap-1.5">
                    <Label htmlFor={id(`min-${entry.locationId}`)}>
                      {`Stock mínimo en ${entry.locationName}`}
                    </Label>
                    <Input
                      id={id(`min-${entry.locationId}`)}
                      inputMode="decimal"
                      autoComplete="off"
                      value={state.minStocks[entry.locationId] ?? ""}
                      onChange={(event) =>
                        patch({
                          minStocks: {
                            ...state.minStocks,
                            [entry.locationId]: event.target.value,
                          },
                        })
                      }
                      {...fieldInvalidProps(
                        id(`min-${entry.locationId}-error`),
                        errorOf(key),
                      )}
                    />
                    <FieldError
                      id={id(`min-${entry.locationId}-error`)}
                      message={errorOf(key)}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
        </fieldset>
      </fieldset>

      {formError === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      {feedback.kind === "saved" ? (
        <p role="status" className="text-sm font-medium">
          Cambios guardados.
        </p>
      ) : null}

      {writable ? null : (
        <p className="text-sm text-muted-foreground">
          {CATALOG_ERROR_MESSAGES["CA-E05"]}
        </p>
      )}

      <div>
        <Button type="submit" disabled={!writable || isPending || created}>
          {isPending
            ? "Guardando…"
            : isEdit
              ? "Guardar cambios"
              : "Guardar producto"}
        </Button>
      </div>
    </form>
  );
}
