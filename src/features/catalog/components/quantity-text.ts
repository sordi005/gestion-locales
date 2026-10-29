import { parseArQuantity } from "@/shared/lib/money";
import type { QuantityInputError, QuantityMilli } from "@/shared/lib/money";
import { ok } from "@/shared/lib/result";
import type { Result } from "@/shared/lib/result";

// Una cantidad (el stock mínimo) como la escribe la persona: `6`, `1,5`. Viaja en
// milésimas enteras; el parseo es de `parseArQuantity` (no se reimplementa).

const MILLI_PER_UNIT = 1000;

/** Milésimas como texto para un campo: `6000` → `6`, `1500` → `1,5`. */
export function formatQuantityText(milli: QuantityMilli): string {
  const whole = Math.floor(milli / MILLI_PER_UNIT);
  const fraction = String(milli % MILLI_PER_UNIT)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole},${fraction}`;
}

/** Vacío es "sin mínimo" (`null`); lo demás pasa por `parseArQuantity`. */
export function parseMinStockText(
  text: string,
): Result<QuantityMilli | null, QuantityInputError> {
  if (text.trim() === "") return ok(null);
  return parseArQuantity(text);
}
