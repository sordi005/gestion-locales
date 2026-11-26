"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { toQuickCreateSuggestion } from "@/features/shared-products";
import { lookupSharedProduct } from "@/features/shared-products/server";
import type { Scan } from "@/shared/lib/scanner/scan-result";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { MoneyInput } from "@/shared/ui/money-input";
import {
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";

import {
  createProduct,
  findProductByBarcode,
  setInitialSalePrice,
} from "../actions";
import { useCatalogCache } from "../cache";
import { QUICK_CREATE_MESSAGES } from "./domain/messages";
import {
  applySuggestion,
  editField,
  initialFormState,
  markNoSuggestion,
  priceLabel,
  setSoldByWeight,
  showMisreadNotice,
  toCreateInput,
  validateForOrigin,
} from "./domain/quick-create-form";
import type {
  FormSuggestion,
  QuickCreateFieldErrors,
  QuickCreateOrigin,
} from "./domain/quick-create-form";
import { submitQuickCreate } from "./domain/submit-quick-create";
import type { QuickCreateOutcome } from "./domain/submit-quick-create";
import { useMountedRef, useReportBusy } from "./use-sheet-guards";

// Formulario de alta de la hoja (C-12, design D5, D7 y D9): nombre, marca, precio y
// "Se vende por peso". La sugerencia de la base compartida llega sola y nunca pisa
// lo que la persona ya escribió.

type CreateProductFormProps = {
  readonly orgId: string;
  readonly scan: Scan;
  readonly origin: QuickCreateOrigin;
  readonly onDone: (outcome: QuickCreateOutcome) => void;
  readonly onCancel: () => void;
  /** Avisa si hay un guardado en vuelo: la hoja no se descarta mientras tanto. */
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onSellAsManualItem?: (scan: Scan) => void;
};

/** `createProduct` marca los campos con la ruta de su esquema; el formulario, con la suya. */
function toFormFieldErrors(
  fieldErrors: Readonly<Partial<Record<string, string>>> | undefined,
): { fields: QuickCreateFieldErrors; general: string | null } {
  const fields: { name?: string; brand?: string; price?: string } = {};
  let general: string | null = null;
  for (const [path, message] of Object.entries(fieldErrors ?? {})) {
    if (message === undefined) continue;
    if (path === "name") fields.name = message;
    else if (path === "brand") fields.brand = message;
    else if (path === "salePriceCents") fields.price = message;
    else general = message;
  }
  return { fields, general };
}

export function CreateProductForm({
  orgId,
  scan,
  origin,
  onDone,
  onCancel,
  onBusyChange,
  onSellAsManualItem,
}: CreateProductFormProps) {
  const { refresh } = useCatalogCache();
  const [form, setForm] = useState(() => initialFormState(scan.key));
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<QuickCreateFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Aparte: la consulta de la sugerencia no debe deshabilitar "Guardar".
  const [, startSuggestionTransition] = useTransition();
  const priceRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const mounted = useMountedRef();
  useReportBusy(pending, onBusyChange);
  const nameId = useId();
  const brandId = useId();
  const priceId = useId();
  const weightId = useId();

  // La sugerencia se pide con la hoja ya abierta y editable; cualquier falla es "sin sugerencia".
  useEffect(() => {
    let cancelled = false;
    startSuggestionTransition(async () => {
      let suggestion: FormSuggestion | null = null;
      try {
        const result = await lookupSharedProduct(scan.raw);
        if (result.ok && result.value !== null) {
          suggestion = toQuickCreateSuggestion(result.value);
        }
      } catch {
        // Sin conexión: igual que sin sugerencia.
      }
      if (cancelled) return;
      setForm((state) =>
        suggestion === null
          ? markNoSuggestion(state, scan.key)
          : applySuggestion(state, suggestion, scan.key),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [scan.raw, scan.key]);

  // Si la sugerencia ya completó el nombre, lo siguiente que falta es el precio.
  const nameFilledBySuggestion =
    form.suggestion === "found" &&
    !form.touched.name &&
    form.values.name !== "";
  // Solo si la persona sigue en el nombre o no movió el foco a ningún lado (el cuerpo
  // de la página o la hoja misma): si está en otro campo, en el enlace de fuentes o en
  // la X, la sugerencia tardía no se lo mueve.
  useEffect(() => {
    if (!nameFilledBySuggestion) return;
    const active = document.activeElement;
    const untouched =
      active === null ||
      active === document.body ||
      active === nameRef.current ||
      (active instanceof HTMLElement &&
        active.getAttribute("role") === "dialog");
    if (untouched) priceRef.current?.focus();
  }, [nameFilledBySuggestion]);

  const clientErrors = attempted ? validateForOrigin(form, origin) : {};
  const errors: QuickCreateFieldErrors = { ...clientErrors, ...serverErrors };

  function clearServerErrors() {
    setServerErrors({});
    setFormError(null);
  }

  function save() {
    if (Object.keys(validateForOrigin(form, origin)).length > 0) {
      setAttempted(true);
      return;
    }
    clearServerErrors();
    startTransition(async () => {
      const result = await submitQuickCreate(
        { orgId, scan, origin, create: toCreateInput(form, scan) },
        { createProduct, findProductByBarcode, setInitialSalePrice },
      );
      // Con la hoja cerrada (o en otro código) el resultado tardío se descarta.
      if (!mounted.current) return;
      if (result.ok) {
        void refresh();
        onDone(result.value);
        return;
      }
      const { fields, general } = toFormFieldErrors(result.error.fieldErrors);
      setServerErrors(fields);
      setFormError(
        Object.keys(fields).length > 0 && general === null
          ? null
          : (general ?? result.error.message),
      );
    });
  }

  return (
    <form
      noValidate
      className="flex min-h-0 flex-col gap-4 overflow-y-auto"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <SheetHeader>
        <SheetTitle>{QUICK_CREATE_MESSAGES.sheetTitleCreate}</SheetTitle>
        <SheetDescription>
          {QUICK_CREATE_MESSAGES.codeLabel}{" "}
          <span className="font-mono tabular-nums">{scan.raw}</span>
        </SheetDescription>
        <div aria-live="polite">
          {showMisreadNotice(form) ? (
            <p className="text-sm text-muted-foreground">
              {QUICK_CREATE_MESSAGES.misreadNotice}
            </p>
          ) : null}
        </div>
      </SheetHeader>

      <div className="flex flex-col gap-4 px-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={nameId}>{QUICK_CREATE_MESSAGES.nameLabel}</Label>
          <Input
            id={nameId}
            ref={nameRef}
            placeholder={QUICK_CREATE_MESSAGES.namePlaceholder}
            autoComplete="off"
            value={form.values.name}
            aria-invalid={errors.name === undefined ? undefined : true}
            aria-describedby={
              errors.name === undefined ? undefined : `${nameId}-error`
            }
            onChange={(event) => {
              clearServerErrors();
              setForm((state) => editField(state, "name", event.target.value));
            }}
          />
          {errors.name === undefined ? null : (
            <p id={`${nameId}-error`} className="text-sm text-destructive">
              {errors.name}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={brandId}>{QUICK_CREATE_MESSAGES.brandLabel}</Label>
          <Input
            id={brandId}
            autoComplete="off"
            placeholder={QUICK_CREATE_MESSAGES.brandPlaceholder}
            value={form.values.brand}
            aria-invalid={errors.brand === undefined ? undefined : true}
            aria-describedby={
              errors.brand === undefined ? undefined : `${brandId}-error`
            }
            onChange={(event) => {
              clearServerErrors();
              setForm((state) => editField(state, "brand", event.target.value));
            }}
          />
          {errors.brand === undefined ? null : (
            <p id={`${brandId}-error`} className="text-sm text-destructive">
              {errors.brand}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={priceId}>{priceLabel(form)}</Label>
          <MoneyInput
            id={priceId}
            ref={priceRef}
            required={origin === "sale"}
            value={form.values.price}
            error={errors.price}
            onValueChange={(cents) => {
              clearServerErrors();
              setForm((state) => editField(state, "price", cents));
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id={weightId}
            checked={form.values.unit === "kg"}
            onCheckedChange={(checked) =>
              setForm((state) => setSoldByWeight(state, checked === true))
            }
          />
          <Label htmlFor={weightId}>
            {QUICK_CREATE_MESSAGES.soldByWeightLabel}
          </Label>
        </div>

        <div aria-live="polite">
          {formError === null ? null : (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>

      <SheetFooter>
        <Button type="submit" disabled={pending}>
          {QUICK_CREATE_MESSAGES.save}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          {QUICK_CREATE_MESSAGES.cancel}
        </Button>
        {origin === "sale" && onSellAsManualItem !== undefined ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onSellAsManualItem(scan)}
          >
            {QUICK_CREATE_MESSAGES.sellAsManualItem}
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {QUICK_CREATE_MESSAGES.attribution} (
          <Link href="/fuentes-de-datos" className="underline">
            {QUICK_CREATE_MESSAGES.sourcesLink}
          </Link>
          )
        </p>
      </SheetFooter>
    </form>
  );
}
