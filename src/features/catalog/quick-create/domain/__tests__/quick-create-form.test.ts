import { describe, expect, it } from "vitest";

import { makeScan } from "../../__tests__/fixtures";
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
} from "../quick-create-form";

// Spec product-quick-create "Alta rápida": estado puro del formulario.

describe("estado inicial y edición", () => {
  it("arranca vacío, por unidad y sin nada tocado", () => {
    expect(initialFormState()).toMatchObject({
      values: { name: "", brand: "", price: null, unit: "unit" },
      touched: { name: false, brand: false, price: false },
      suggestion: "pending",
    });
  });

  it("editar un campo lo guarda, lo marca como tocado y no muta el estado anterior", () => {
    const before = initialFormState();

    const after = editField(before, "name", "Alfajor");

    expect(after.values.name).toBe("Alfajor");
    expect(after.touched).toEqual({ name: true, brand: false, price: false });
    expect(before.values.name).toBe("");
    expect(before.touched.name).toBe(false);
  });

  it("editar el precio guarda los centavos", () => {
    const after = editField(initialFormState(), "price", 90000);

    expect(after.values.price).toBe(90000);
    expect(after.touched.price).toBe(true);
  });
});

describe("validateForOrigin", () => {
  const filled = editField(initialFormState(), "name", "Alfajor");

  it("desde la venta exige nombre y precio", () => {
    expect(validateForOrigin(initialFormState(), "sale")).toEqual({
      name: "Escribí el nombre del producto.",
      price: "Poné el precio.",
    });
    expect(validateForOrigin(filled, "sale")).toEqual({
      price: "Poné el precio.",
    });
  });

  it("desde un conteo solo exige el nombre", () => {
    expect(validateForOrigin(initialFormState(), "count")).toEqual({
      name: "Escribí el nombre del producto.",
    });
    expect(validateForOrigin(filled, "count")).toEqual({});
  });

  it("un precio de $0 se rechaza desde cualquier origen, también por kilo", () => {
    const zero = editField(filled, "price", 0);

    for (const origin of ["sale", "count", "catalog"] as const) {
      expect(validateForOrigin(zero, origin)).toEqual({
        price: "El precio tiene que ser mayor a $0.",
      });
    }
    expect(validateForOrigin(setSoldByWeight(zero, true), "sale")).toEqual({
      price: "El precio tiene que ser mayor a $0.",
    });
  });

  it("un precio mayor a $0 y un precio vacío fuera de la venta no dan error", () => {
    expect(validateForOrigin(editField(filled, "price", 1), "sale")).toEqual(
      {},
    );
    expect(validateForOrigin(filled, "purchase")).toEqual({});
  });
});

describe("Se vende por peso", () => {
  it("pasa a kg, cambia la etiqueta del precio y conserva lo escrito", () => {
    const priced = editField(initialFormState(), "price", 120000);

    const byWeight = setSoldByWeight(priced, true);

    expect(byWeight.values.unit).toBe("kg");
    expect(priceLabel(byWeight)).toBe("Precio por kilo");
    expect(byWeight.values.price).toBe(120000);
  });

  it("desmarcarla vuelve a unidad y a la etiqueta 'Precio'", () => {
    const back = setSoldByWeight(
      setSoldByWeight(initialFormState(), true),
      false,
    );

    expect(back.values.unit).toBe("unit");
    expect(priceLabel(back)).toBe("Precio");
  });
});

describe("toCreateInput", () => {
  it("arma el alta por unidad con el código tal como se leyó y sin controles de stock", () => {
    const scan = makeScan();
    let state = editField(initialFormState(), "name", "  Galletitas  ");
    state = editField(state, "brand", "Campo Verde");
    state = editField(state, "price", 90000);

    const input = toCreateInput(state, scan);

    expect(input).toEqual({
      name: "Galletitas",
      brand: "Campo Verde",
      unit: "unit",
      salePriceCents: 90000,
      barcodes: [scan.raw],
    });
    expect(input).not.toHaveProperty("tracksStock");
    expect(input).not.toHaveProperty("tracksExpiry");
  });

  it("marca en blanco → null, sin precio → null y por peso → kg", () => {
    const scan = makeScan();
    const state = setSoldByWeight(
      editField(editField(initialFormState(), "name", "Queso"), "brand", "  "),
      true,
    );

    expect(toCreateInput(state, scan)).toEqual({
      name: "Queso",
      brand: null,
      unit: "kg",
      salePriceCents: null,
      barcodes: [scan.raw],
    });
  });
});

describe("sugerencia a tiempo", () => {
  it("completa nombre y marca vacíos, siguen editables y no se toca el precio", () => {
    const state = applySuggestion(initialFormState(), {
      name: "Galletitas de limón 120 g",
      brand: "Campo Verde",
    });

    expect(state.values).toMatchObject({
      name: "Galletitas de limón 120 g",
      brand: "Campo Verde",
      price: null,
      unit: "unit",
    });
    expect(state.touched).toEqual({ name: false, brand: false, price: false });
    expect(editField(state, "brand", "Otra").values.brand).toBe("Otra");
  });

  it("con otro nombre y marca la sugerencia completa lo mismo", () => {
    const state = applySuggestion(initialFormState(), {
      name: "Yerba 1 kg",
      brand: "Taragüí",
    });

    expect(state.values.name).toBe("Yerba 1 kg");
    expect(state.values.brand).toBe("Taragüí");
  });
});

describe("aviso de número", () => {
  it("no se muestra mientras la consulta está en curso", () => {
    expect(showMisreadNotice(initialFormState())).toBe(false);
  });

  it("se muestra cuando la consulta terminó sin sugerencia y no bloquea guardar", () => {
    const state = editField(markNoSuggestion(initialFormState()), "name", "X");

    expect(showMisreadNotice(state)).toBe(true);
    expect(validateForOrigin(state, "count")).toEqual({});
  });

  it("no se muestra cuando hubo sugerencia", () => {
    const state = applySuggestion(initialFormState(), {
      name: "Yerba",
      brand: null,
    });

    expect(showMisreadNotice(state)).toBe(false);
  });
});

describe("sugerencia tardía (triangulación)", () => {
  it("no pisa un nombre ya escrito y completa la marca", () => {
    const typing = editField(initialFormState(), "name", "Mi alfajor");

    const state = applySuggestion(typing, {
      name: "Alfajor X",
      brand: "Marca",
    });

    expect(state.values.name).toBe("Mi alfajor");
    expect(state.values.brand).toBe("Marca");
  });

  it("un campo tocado y borrado sigue vacío", () => {
    const cleared = editField(
      editField(initialFormState(), "name", "Algo"),
      "name",
      "",
    );

    const state = applySuggestion(cleared, { name: "Alfajor X", brand: "M" });

    expect(state.values.name).toBe("");
    expect(state.values.brand).toBe("M");
  });

  it("una marca null en la sugerencia no toca nada", () => {
    const state = applySuggestion(initialFormState(), {
      name: "Yerba",
      brand: null,
    });

    expect(state.values.brand).toBe("");
    expect(state.touched.brand).toBe(false);
  });

  it("nunca toca el precio ni la opción de peso", () => {
    const base = setSoldByWeight(
      editField(initialFormState(), "price", 500),
      true,
    );

    const state = applySuggestion(base, { name: "N", brand: "B" });

    expect(state.values.price).toBe(500);
    expect(state.values.unit).toBe("kg");
  });

  it("descarta una sugerencia de otro código", () => {
    const state = initialFormState("7790001000019");

    const same = applySuggestion(
      state,
      { name: "A", brand: null },
      "7790001000019",
    );
    const other = applySuggestion(
      state,
      { name: "B", brand: null },
      "7790009999990",
    );
    const noneOther = markNoSuggestion(state, "7790009999990");

    expect(same.values.name).toBe("A");
    expect(other).toBe(state);
    expect(noneOther).toBe(state);
    expect(showMisreadNotice(noneOther)).toBe(false);
  });
});

describe("validateForOrigin por origen, unidad y largo", () => {
  const named = editField(initialFormState(), "name", "Algo");
  const priced = editField(named, "price", 100);
  const byWeight = (s: typeof named) => setSoldByWeight(s, true);

  it.each([
    ["sale", true],
    ["purchase", false],
    ["waste", false],
    ["count", false],
    ["catalog", false],
  ] as const)("origen %s: precio obligatorio = %s", (origin, required) => {
    expect(validateForOrigin(named, origin).price !== undefined).toBe(required);
    expect(validateForOrigin(priced, origin)).toEqual({});
  });

  it("desde la venta el precio por kilo también es obligatorio, con su texto", () => {
    expect(validateForOrigin(byWeight(named), "sale")).toEqual({
      price: "Poné el precio por kilo.",
    });
    expect(validateForOrigin(byWeight(priced), "sale")).toEqual({});
  });

  it("un nombre de 200 caracteres pasa y uno de 201 da error en castellano", () => {
    const ok200 = editField(initialFormState(), "name", "a".repeat(200));
    const bad201 = editField(initialFormState(), "name", "a".repeat(201));

    expect(validateForOrigin(ok200, "count")).toEqual({});
    expect(validateForOrigin(bad201, "count")).toEqual({
      name: "El nombre puede tener hasta 200 caracteres.",
    });
  });

  it("una marca de 81 caracteres da error", () => {
    const state = editField(named, "brand", "b".repeat(81));

    expect(validateForOrigin(state, "count")).toEqual({
      brand: "La marca puede tener hasta 80 caracteres.",
    });
  });

  it("el nombre en blanco (solo espacios) no vale", () => {
    const blank = editField(initialFormState(), "name", "   ");

    expect(validateForOrigin(blank, "count").name).toBe(
      "Escribí el nombre del producto.",
    );
  });
});
