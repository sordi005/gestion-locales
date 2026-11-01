import { describe, expect, it } from "vitest";

import {
  PRICE_CHANGE_COLUMNS,
  PRICE_SOURCE_LABELS,
  historyActorLabel,
  priceSourceLabel,
  toPriceHistoryEntry,
} from "../price-history";

const USER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000009";

describe("priceSourceLabel: origen del cambio en castellano", () => {
  it.each<[string, string]>([
    ["manual", "Cambio manual"],
    ["quick_create", "Alta rápida"],
    ["bulk_update", "Actualización masiva"],
    ["bulk_revert", "Reversión"],
    ["catalog_import", "Importación"],
  ])("%s → %s", (source, label) => {
    expect(priceSourceLabel(source)).toBe(label);
  });

  it("cubre los cinco orígenes que acepta el CHECK de price_changes", () => {
    expect(Object.keys(PRICE_SOURCE_LABELS).sort()).toEqual([
      "bulk_revert",
      "bulk_update",
      "catalog_import",
      "manual",
      "quick_create",
    ]);
  });

  it("un origen desconocido no rompe la pantalla", () => {
    expect(priceSourceLabel("futuro")).toBe("Otro origen");
  });
});

describe("historyActorLabel", () => {
  it("nombre visible", () => {
    expect(historyActorLabel(USER, "Dueño Demo Norte")).toBe(
      "Dueño Demo Norte",
    );
  });

  it("perfil que RLS no deja leer: Otra persona", () => {
    expect(historyActorLabel(OTHER, undefined)).toBe("Otra persona");
    expect(historyActorLabel(OTHER, null)).toBe("Otra persona");
  });

  it("perfil visible pero sin nombre: Otra persona", () => {
    expect(historyActorLabel(OTHER, "")).toBe("Otra persona");
    expect(historyActorLabel(OTHER, "   ")).toBe("Otra persona");
  });

  it("sin usuario (un proceso del sistema): Sistema, aunque haya un nombre suelto", () => {
    expect(historyActorLabel(null, undefined)).toBe("Sistema");
    expect(historyActorLabel(null, "Alguien")).toBe("Sistema");
  });
});

describe("PRICE_CHANGE_COLUMNS", () => {
  it("son columnas explícitas, sin comodín", () => {
    expect(PRICE_CHANGE_COLUMNS).not.toContain("*");
    expect(PRICE_CHANGE_COLUMNS.split(",").map((c) => c.trim())).toEqual([
      "id",
      "old_price",
      "new_price",
      "source",
      "changed_by",
      "changed_at",
    ]);
  });
});

describe("toPriceHistoryEntry", () => {
  const names = new Map([[USER, "Dueño Demo Norte"]]);

  it("arma las etiquetas: fecha local, precios con formatArs y quién lo hizo", () => {
    expect(
      toPriceHistoryEntry(
        {
          id: "h1",
          old_price: 1000,
          new_price: 1150,
          source: "manual",
          changed_by: USER,
          changed_at: "2026-10-20T15:30:00+00:00",
        },
        names,
      ),
    ).toStrictEqual({
      id: "h1",
      changedAtLabel: "20/10/2026 12:30",
      oldPriceLabel: "$ 1.000,00",
      newPriceLabel: "$ 1.150,00",
      sourceLabel: "Cambio manual",
      actorLabel: "Dueño Demo Norte",
    });
  });

  it("sin precio anterior muestra —; de un autor ajeno, Otra persona; sin autor, Sistema", () => {
    const base = {
      id: "h2",
      old_price: null,
      new_price: 900,
      source: "quick_create",
      changed_at: "2026-01-02T03:04:05+00:00",
    };

    expect(
      toPriceHistoryEntry({ ...base, changed_by: OTHER }, names),
    ).toMatchObject({
      oldPriceLabel: "—",
      newPriceLabel: "$\u00a0900,00",
      sourceLabel: "Alta rápida",
      actorLabel: "Otra persona",
      changedAtLabel: "02/01/2026 00:04",
    });
    expect(
      toPriceHistoryEntry({ ...base, changed_by: null }, names).actorLabel,
    ).toBe("Sistema");
  });

  it("un precio anterior de cero es $ 0,00, no —", () => {
    expect(
      toPriceHistoryEntry(
        {
          id: "h3",
          old_price: 0,
          new_price: 5,
          source: "manual",
          changed_by: null,
          changed_at: "2026-10-20T15:30:00+00:00",
        },
        names,
      ).oldPriceLabel,
    ).toBe("$ 0,00");
  });
});
