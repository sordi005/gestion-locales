import { describe, expect, it } from "vitest";

import {
  approveInputSchema,
  barcodeInputSchema,
  parseAdminInput,
  queueInputSchema,
  rejectInputSchema,
  retireInputSchema,
  updateInputSchema,
} from "../domain/schemas";

// Spec shared-product-review "Pantalla de revisión en el panel del admin": las
// acciones validan la entrada con Zod y muestran los errores en español. Los
// límites son los de la tabla (nombre 200, marca 80, presentación 40, motivo 500).

describe("approveInputSchema / updateInputSchema", () => {
  it("acepta código, nombre, marca y presentación y recorta los espacios", () => {
    const parsed = parseAdminInput(approveInputSchema, {
      barcode: " 7791234567898 ",
      name: "  Alfajor Triple  ",
      brand: " Marca Demo ",
      presentation: " 70 g ",
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        barcode: "7791234567898",
        name: "Alfajor Triple",
        brand: "Marca Demo",
        presentation: "70 g",
      },
    });
  });

  it("marca y presentación vacías o ausentes quedan sin valor", () => {
    const empty = parseAdminInput(updateInputSchema, {
      barcode: "7791234567898",
      name: "Alfajor",
      brand: "   ",
      presentation: "",
    });
    const missing = parseAdminInput(updateInputSchema, {
      barcode: "7791234567898",
      name: "Alfajor",
    });

    for (const parsed of [empty, missing]) {
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value.brand).toBeUndefined();
        expect(parsed.value.presentation).toBeUndefined();
      }
    }
  });

  it("sin nombre o con el nombre en blanco: SP-A01 con el error en el campo", () => {
    for (const name of ["", "   ", undefined]) {
      const parsed = parseAdminInput(approveInputSchema, {
        barcode: "7791234567898",
        name,
      });

      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("SP-A01");
        expect(parsed.error.fieldErrors?.name).toBe("Escribí el nombre.");
      }
    }
  });

  it("respeta los límites de la tabla: 200, 80 y 40 pasan; 201, 81 y 41 no", () => {
    expect(
      parseAdminInput(approveInputSchema, {
        barcode: "7791234567898",
        name: "n".repeat(200),
        brand: "b".repeat(80),
        presentation: "p".repeat(40),
      }).ok,
    ).toBe(true);

    const tooLong = parseAdminInput(approveInputSchema, {
      barcode: "7791234567898",
      name: "n".repeat(201),
      brand: "b".repeat(81),
      presentation: "p".repeat(41),
    });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(Object.keys(tooLong.error.fieldErrors ?? {}).sort()).toEqual([
        "brand",
        "name",
        "presentation",
      ]);
    }
  });

  it("un código que no son solo dígitos, es de ceros o pasa de 14: SP-A01 en el campo barcode", () => {
    for (const barcode of ["", "abc", "7791 234", "0000", "123456789012345"]) {
      const parsed = parseAdminInput(approveInputSchema, {
        barcode,
        name: "Alfajor",
      });

      expect(parsed.ok, barcode).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.fieldErrors?.barcode).toBe(
          "El código tiene que tener solo números (hasta 14).",
        );
      }
    }
  });

  it("descarta las claves de más: una organización que llegue en el pedido no pasa", () => {
    const parsed = parseAdminInput(approveInputSchema, {
      barcode: "7791234567898",
      name: "Alfajor",
      organization_id: "11111111-1111-4111-8111-111111111111",
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(Object.keys(parsed.value)).not.toContain("organization_id");
    }
  });
});

describe("rejectInputSchema / retireInputSchema", () => {
  it("piden un motivo de 1 a 500 caracteres, recortado", () => {
    expect(
      parseAdminInput(rejectInputSchema, {
        barcode: "7791234567898",
        reason: "  Nombre ofensivo  ",
      }),
    ).toEqual({
      ok: true,
      value: { barcode: "7791234567898", reason: "Nombre ofensivo" },
    });
    expect(
      parseAdminInput(retireInputSchema, {
        barcode: "7791234567898",
        reason: "r".repeat(500),
      }).ok,
    ).toBe(true);
  });

  it("sin motivo, en blanco o de 501 caracteres: SP-A01 con mensaje en español", () => {
    for (const reason of ["", "  ", "r".repeat(501)]) {
      for (const schema of [rejectInputSchema, retireInputSchema]) {
        const parsed = parseAdminInput(schema, {
          barcode: "7791234567898",
          reason,
        });

        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
          expect(parsed.error.fieldErrors?.reason).toBe(
            "Escribí el motivo (hasta 500 caracteres).",
          );
        }
      }
    }
  });
});

describe("queueInputSchema", () => {
  it("por defecto pide 50 por página y sin cursor", () => {
    expect(parseAdminInput(queueInputSchema, {})).toEqual({
      ok: true,
      value: { limit: 50 },
    });
  });

  it("acepta un límite de 1 a 200 y un cursor numérico", () => {
    expect(
      parseAdminInput(queueInputSchema, {
        limit: 200,
        cursor: "7791234567898",
      }),
    ).toEqual({ ok: true, value: { limit: 200, cursor: "7791234567898" } });
  });

  it("rechaza 0, 201, decimales y un cursor que no es un código", () => {
    for (const input of [
      { limit: 0 },
      { limit: 201 },
      { limit: 1.5 },
      { cursor: "abc; drop table" },
    ]) {
      expect(parseAdminInput(queueInputSchema, input).ok).toBe(false);
    }
  });
});

describe("barcodeInputSchema", () => {
  it("valida solo el código (para buscar una entrada)", () => {
    expect(
      parseAdminInput(barcodeInputSchema, { barcode: "036000291452" }),
    ).toEqual({ ok: true, value: { barcode: "036000291452" } });
    expect(parseAdminInput(barcodeInputSchema, { barcode: "x" }).ok).toBe(
      false,
    );
  });
});
