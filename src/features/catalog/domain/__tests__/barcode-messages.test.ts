import { describe, expect, it } from "vitest";

import { normalizeBarcode } from "@/shared/lib/barcode";
import type { BarcodeRejection, BarcodeWarning } from "@/shared/lib/barcode";
import { isErr } from "@/shared/lib/result";

import {
  BARCODE_REJECTIONS,
  barcodeRejectionMessage,
  barcodeWarningMessage,
  invalidBarcodeError,
} from "../barcode-messages";

describe("barcodeRejectionMessage: un mensaje por cada motivo de rechazo", () => {
  it("cubre exactamente los motivos que produce normalizeBarcode", () => {
    // Cada entrada sale de normalizeBarcode real, no de una lista copiada.
    const produced = new Set<BarcodeRejection>();
    for (const raw of [
      "",
      "7.79E+12",
      "12.5",
      "ABC123",
      "123456789012345",
      "000",
    ]) {
      const result = normalizeBarcode(raw);
      if (isErr(result)) produced.add(result.error);
    }

    expect([...produced].sort()).toEqual([...BARCODE_REJECTIONS].sort());
  });

  it.each<[BarcodeRejection, string]>([
    ["empty", "El código no es válido: está vacío."],
    [
      "scientific_notation",
      "El código no es válido: el código perdió dígitos (viene en notación científica); copialo de nuevo desde su origen o escribilo completo.",
    ],
    [
      "decimal",
      "El código no es válido: tiene decimales; tiene que ser un número entero.",
    ],
    [
      "invalid_characters",
      "El código no es válido: solo puede tener números (se admiten espacios y guiones entre grupos de dígitos).",
    ],
    ["too_long", "El código no es válido: tiene más de 14 dígitos."],
    ["all_zeros", "El código no es válido: no puede ser solo ceros."],
  ])("%s", (rejection, expected) => {
    expect(barcodeRejectionMessage(rejection)).toBe(expected);
  });

  it("los seis mensajes son distintos entre sí", () => {
    const messages = BARCODE_REJECTIONS.map(barcodeRejectionMessage);

    expect(new Set(messages).size).toBe(BARCODE_REJECTIONS.length);
  });
});

describe("barcodeWarningMessage", () => {
  it("invalid_check_digit dice de qué código habla y deja guardar igual", () => {
    expect(barcodeWarningMessage("invalid_check_digit", "7790001000013")).toBe(
      "El código 7790001000013: el dígito verificador no coincide, revisalo. Si es interno, podés guardarlo igual.",
    );
  });

  it("el mensaje nombra el código que recibe (con otro código, otro texto)", () => {
    expect(barcodeWarningMessage("invalid_check_digit", "12345670")).toContain(
      "El código 12345670:",
    );
  });

  it("es el aviso que produce normalizeBarcode con un EAN-13 mal verificado", () => {
    const result = normalizeBarcode("7790001000013");
    const warnings: readonly BarcodeWarning[] = result.ok
      ? result.value.warnings
      : [];

    expect(
      warnings.map((warning) =>
        barcodeWarningMessage(warning, "7790001000013"),
      ),
    ).toEqual([
      "El código 7790001000013: el dígito verificador no coincide, revisalo. Si es interno, podés guardarlo igual.",
    ]);
  });
});

describe("invalidBarcodeError (CA-E09)", () => {
  it.each(BARCODE_REJECTIONS)("%s arma un CA-E09 serializable", (rejection) => {
    const error = invalidBarcodeError(rejection);

    expect(error).toStrictEqual({
      code: "CA-E09",
      message: barcodeRejectionMessage(rejection),
      details: { reason: rejection },
    });
    expect(structuredClone(error)).toStrictEqual(error);
  });
});
