import type { Cents } from "@/shared/lib/money";
import type { Scan } from "@/shared/lib/scanner/scan-result";

import type { ProductUnit } from "../../domain/product-view";
import { MAX_BRAND_CHARACTERS, MAX_NAME_CHARACTERS } from "../../domain/limits";
import { QUICK_CREATE_MESSAGES } from "./messages";

// Estado puro del formulario del alta rápida (C-12, design D7 y D9): sin React ni
// I/O, así las reglas (qué se exige según el origen, qué pisa una sugerencia tardía)
// se prueban con tablas.

/** Desde dónde se abre la hoja: la venta exige precio, los demás no. */
export type QuickCreateOrigin =
  "sale" | "purchase" | "waste" | "count" | "catalog";

export type QuickCreateField = "name" | "brand" | "price";

export type QuickCreateFormState = {
  readonly values: {
    readonly name: string;
    readonly brand: string;
    readonly price: Cents | null;
    readonly unit: ProductUnit;
  };
  /** Un campo pasa a `touched` con el primer cambio de la persona y no vuelve atrás. */
  readonly touched: Readonly<Record<QuickCreateField, boolean>>;
  readonly suggestion: "pending" | "found" | "none";
  /** Clave del código al que pertenece el formulario: una sugerencia de otra se descarta. */
  readonly key: string;
};

export type QuickCreateFieldErrors = Readonly<
  Partial<Record<QuickCreateField, string>>
>;

export function initialFormState(key = ""): QuickCreateFormState {
  return {
    key,
    values: { name: "", brand: "", price: null, unit: "unit" },
    touched: { name: false, brand: false, price: false },
    suggestion: "pending",
  };
}

export function editField(
  state: QuickCreateFormState,
  field: "name" | "brand",
  value: string,
): QuickCreateFormState;
export function editField(
  state: QuickCreateFormState,
  field: "price",
  value: Cents | null,
): QuickCreateFormState;
export function editField(
  state: QuickCreateFormState,
  field: QuickCreateField,
  value: string | Cents | null,
): QuickCreateFormState {
  return {
    ...state,
    values: { ...state.values, [field]: value },
    touched: { ...state.touched, [field]: true },
  };
}

/** Precio obligatorio (`required`) y siempre mayor a $0 cuando hay uno. */
export function validatePrice(
  price: Cents | null,
  unit: ProductUnit,
  required: boolean,
): string | undefined {
  if (price === null) {
    if (!required) return undefined;
    return unit === "kg"
      ? QUICK_CREATE_MESSAGES.priceRequiredPerKg
      : QUICK_CREATE_MESSAGES.priceRequired;
  }
  return price === 0 ? QUICK_CREATE_MESSAGES.priceMustBePositive : undefined;
}

export function validateForOrigin(
  state: QuickCreateFormState,
  origin: QuickCreateOrigin,
): QuickCreateFieldErrors {
  const errors: { name?: string; brand?: string; price?: string } = {};
  const name = state.values.name.trim();
  if (name === "") {
    errors.name = QUICK_CREATE_MESSAGES.nameRequired;
  } else if (name.length > MAX_NAME_CHARACTERS) {
    errors.name = QUICK_CREATE_MESSAGES.nameTooLong;
  }
  if (state.values.brand.trim().length > MAX_BRAND_CHARACTERS) {
    errors.brand = QUICK_CREATE_MESSAGES.brandTooLong;
  }
  const priceError = validatePrice(
    state.values.price,
    state.values.unit,
    origin === "sale",
  );
  if (priceError !== undefined) errors.price = priceError;
  return errors;
}

/** "Se vende por peso": unidad `kg` y el precio pasa a ser por kilo (RN-CA-10). */
export function setSoldByWeight(
  state: QuickCreateFormState,
  soldByWeight: boolean,
): QuickCreateFormState {
  return {
    ...state,
    values: { ...state.values, unit: soldByWeight ? "kg" : "unit" },
  };
}

export function priceLabel(state: QuickCreateFormState): string {
  return state.values.unit === "kg"
    ? QUICK_CREATE_MESSAGES.priceLabelPerKg
    : QUICK_CREATE_MESSAGES.priceLabel;
}

/** Lo que recibe `createProduct`: sin `tracksStock`/`tracksExpiry` (quedan en `true`, RN-CA-06). */
export type QuickCreateInput = {
  readonly name: string;
  readonly brand: string | null;
  readonly unit: ProductUnit;
  readonly salePriceCents: Cents | null;
  readonly barcodes: string[];
};

export function toCreateInput(
  state: QuickCreateFormState,
  scan: Scan,
): QuickCreateInput {
  const brand = state.values.brand.trim();
  return {
    name: state.values.name.trim(),
    brand: brand === "" ? null : brand,
    unit: state.values.unit,
    salePriceCents: state.values.price,
    barcodes: [scan.raw],
  };
}

/** Nombre y marca sugeridos por la base compartida (el nombre ya trae la presentación). */
export type FormSuggestion = {
  readonly name: string;
  readonly brand: string | null;
};

/** Solo completa un campo vacío y sin tocar; nunca toca el precio ni la unidad. */
export function applySuggestion(
  state: QuickCreateFormState,
  suggestion: FormSuggestion,
  key: string = state.key,
): QuickCreateFormState {
  if (key !== state.key) return state;
  const fillable = (field: "name" | "brand", value: string | null) =>
    value !== null && !state.touched[field] && state.values[field] === ""
      ? value
      : state.values[field];
  return {
    ...state,
    values: {
      ...state.values,
      name: fillable("name", suggestion.name),
      brand: fillable("brand", suggestion.brand),
    },
    suggestion: "found",
  };
}

/** La consulta a la base compartida terminó sin sugerencia (nada, error o falla de red). */
export function markNoSuggestion(
  state: QuickCreateFormState,
  key: string = state.key,
): QuickCreateFormState {
  if (key !== state.key) return state;
  return { ...state, suggestion: "none" };
}

/** "Revisá que el número coincida con el de la caja": solo con la consulta terminada y vacía. */
export function showMisreadNotice(state: QuickCreateFormState): boolean {
  return state.suggestion === "none";
}
