import { describe, expect, it } from "vitest";

import { sharedBaseEligibility } from "@/shared/lib/barcode";
import type { SharedBaseEligibility } from "@/shared/lib/barcode";

/**
 * CONTRATO DE C-64 (`barcode-normalization`, tarea 2.2). Esta tabla es la MISMA, copiada
 * literal, que la de `supabase/tests/050-shared-products-model.test.sql` (espejo de
 * `private.shared_barcode_eligibility`). Un test de tooling
 * (`tests/tooling/shared-eligibility-table.test.ts`) falla si las dos difieren: no las
 * edites por separado.
 */
const CASES: ReadonlyArray<readonly [string, SharedBaseEligibility]> = [
  // eligibility-cases:start
  ["7791234567898", "eligible"], // ean13 779 valid
  ["7791234567899", "invalid_check_digit"], // ean13 779 wrong check digit
  ["036000291452", "eligible"], // upc-a valid
  ["0036000291452", "eligible"], // same upc-a as ean13 with 0
  ["77901231", "eligible"], // ean8 starting 7
  ["01234565", "restricted_other"], // ean8 starting 0
  ["21234569", "restricted_other"], // ean8 starting 2
  ["2012345678903", "restricted_internal"], // ean13 starting 20
  ["2112345678900", "restricted_internal"], // ean13 starting 21
  ["2912345678906", "restricted_internal"], // ean13 starting 29
  ["212345678909", "variable_measure"], // upc-a starting 2 (-> 02)
  ["0412345678903", "restricted_other"], // ean13 starting 04
  ["0512345678900", "restricted_other"], // ean13 starting 05
  ["9801234567892", "restricted_other"], // ean13 starting 980
  ["9841234567898", "restricted_other"], // ean13 starting 984
  ["9912345678909", "restricted_other"], // ean13 starting 99
  ["9771234567898", "eligible"], // ean13 977 (issn)
  ["9781234567897", "eligible"], // ean13 978 (isbn)
  ["9791234567896", "eligible"], // ean13 979 (isbn)
  ["17791234567895", "unsupported_length"], // gtin-14 valid
  ["7", "unsupported_length"], // length 1
  ["7790123", "unsupported_length"], // length 7
  ["7791234567", "unsupported_length"], // length 10
  ["77912345678", "unsupported_length"], // length 11
  ["0000077901231", "eligible"], // gtin-8 padded to 13, starting 7
  ["0000001234565", "restricted_other"], // gtin-8 padded to 13, starting 0
  ["0000021234569", "restricted_other"], // gtin-8 padded to 13, starting 2
  ["0000077901232", "invalid_check_digit"], // gtin-8 padded to 13, wrong check digit
  ["000001234565", "restricted_other"], // gtin-8 padded to 12, starting 0
  ["000021234569", "restricted_other"], // gtin-8 padded to 12, starting 2
  ["000077901231", "eligible"], // gtin-8 padded to 12, starting 7
  // eligibility-cases:end
];

describe("sharedBaseEligibility", () => {
  it.each(CASES)("%s -> %s", (code, expected) => {
    expect(sharedBaseEligibility(code)).toBe(expected);
  });

  it("la tabla tiene los 31 casos del contrato", () => {
    expect(CASES).toHaveLength(31);
  });

  it("un texto que no son solo dígitos es unsupported_length (la app ya normalizó)", () => {
    expect(sharedBaseEligibility("77901231x")).toBe("unsupported_length");
    expect(sharedBaseEligibility("")).toBe("unsupported_length");
  });
});
