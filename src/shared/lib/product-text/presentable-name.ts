import { brandCase } from "./brand-case";
import { firstWordExpansion } from "./dictionary";
import { foldText } from "./fold";
import { rewriteUnits } from "./units";

// Nombre presentable de un producto de la base compartida (C-65, design D8): las
// mismas reglas corren al cargar la base y al leer la sugerencia, y son idempotentes.

/** Largo máximo del nombre de un producto del catálogo (C-08). */
const MAX_NAME_LENGTH = 200;

// La primera palabra: solo letras, con un punto final opcional ("Gall.").
const FIRST_WORD = /^(\p{L}+)\.?(?=\s|$)/u;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * La marca escrita TODA en mayúsculas dentro del nombre (palabra entera) con su forma
 * bien escrita. Una aparición con minúsculas ("Yogur natural" con la marca "Natural")
 * se deja como está. Sin "lookbehind" (los iPhone viejos no lo entienden): el borde
 * izquierdo va en un grupo y se vuelve a escribir.
 */
function replaceBrand(name: string, brand: string | null): string {
  const trimmed = brand?.trim() ?? "";
  if (trimmed === "") return name;
  const pattern = new RegExp(
    String.raw`(^|[^\p{L}\p{N}])(${escapeRegExp(trimmed)})(?![\p{L}\p{N}])`,
    "giu",
  );
  const formatted = brandCase(trimmed);
  return withinLimit(
    name,
    name.replace(pattern, (whole, left: string, found: string) =>
      isUpperCaseWord(found) ? `${left}${formatted}` : whole,
    ),
  );
}

/** ¿Tiene letras y todas son mayúsculas? */
function isUpperCaseWord(text: string): boolean {
  return /\p{L}/u.test(text) && text === text.toUpperCase();
}

/** El paso que agranda el texto no puede pasar del máximo: si pasa, se queda el anterior. */
function withinLimit(previous: string, next: string): string {
  return next.length > MAX_NAME_LENGTH ? previous : next;
}

function expandFirstWord(name: string): string {
  const match = FIRST_WORD.exec(name);
  const word = match?.[1];
  if (match === null || word === undefined) return name;
  const canonical = firstWordExpansion(foldText(word));
  if (canonical === null) return name;
  const expanded = canonical.charAt(0).toUpperCase() + canonical.slice(1);
  return withinLimit(name, expanded + name.slice(match[0].length));
}

export type PresentableNameSteps = {
  /** Después de reescribir las unidades. */
  readonly units: string;
  /** Después de escribir bien la marca. */
  readonly brand: string;
  /** Después de expandir la primera palabra: el nombre presentable. */
  readonly final: string;
};

/** El nombre después de cada regla, para contar cuántos nombres cambia cada una. */
export function presentableNameSteps(
  name: string,
  brand: string | null,
): PresentableNameSteps {
  const units = withinLimit(name, rewriteUnits(name));
  const withBrand = replaceBrand(units, brand);
  return { units, brand: withBrand, final: expandFirstWord(withBrand) };
}

/**
 * El nombre con las unidades en su forma corta ("700 cm3" → "700 ml"), la marca bien
 * escrita ("DOVE" → "Dove") y, solo en la primera palabra, una abreviatura segura
 * expandida ("Deo" → "Desodorante"). Aplicarla dos veces da lo mismo que una.
 */
export function presentableName(name: string, brand: string | null): string {
  return presentableNameSteps(name, brand).final;
}
