import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PriceHistoryEntry } from "../..";
import { toPriceHistoryEntry } from "../..";

import { PriceHistory } from "../price-history";

// Spec catalog-price-editing "Historial de precios del producto": los últimos
// cambios del más nuevo al más viejo, con fecha local, antes ("—" si no había),
// ahora, origen en castellano y quién ("Otra persona" si no se puede ver el
// perfil, "Sistema" si no hubo usuario).

function entry(over: Partial<PriceHistoryEntry> = {}): PriceHistoryEntry {
  return {
    id: "c1",
    changedAtLabel: "28/10/2026 10:30",
    oldPriceLabel: "$ 1.000,00",
    newPriceLabel: "$ 1.150,00",
    sourceLabel: "Cambio manual",
    actorLabel: "Dueño Demo Norte",
    ...over,
  };
}

describe("PriceHistory", () => {
  it("muestra una fila por cambio, en el orden recibido, con todas sus columnas", () => {
    render(
      <PriceHistory
        entries={[
          entry({ id: "c2", changedAtLabel: "28/10/2026 10:30" }),
          entry({
            id: "c1",
            changedAtLabel: "01/10/2026 09:00",
            oldPriceLabel: "—",
            newPriceLabel: "$ 1.000,00",
            sourceLabel: "Alta rápida",
            actorLabel: "Empleado Demo Norte",
          }),
        ]}
      />,
    );

    const rows = screen.getAllByRole("row");
    // Encabezado + 2 filas.
    expect(rows).toHaveLength(3);
    const [newest, oldest] = [rows[1]!, rows[2]!];
    for (const text of [
      "28/10/2026 10:30",
      "$ 1.000,00",
      "$ 1.150,00",
      "Cambio manual",
      "Dueño Demo Norte",
    ]) {
      expect(newest).toHaveTextContent(text.replace(/ /g, " "));
    }
    expect(within(oldest).getByText("—")).toBeVisible();
    expect(oldest).toHaveTextContent("Alta rápida");
    expect(oldest).toHaveTextContent("Empleado Demo Norte");
  });

  it("tiene encabezados de columna", () => {
    render(<PriceHistory entries={[entry()]} />);

    for (const name of ["Fecha", "Antes", "Ahora", "Origen", "Quién"]) {
      expect(screen.getByRole("columnheader", { name })).toBeVisible();
    }
  });

  it("muestra 'Otra persona' y 'Sistema' tal como llegan del DTO", () => {
    // Se arma con la función real que produce las etiquetas, no a mano.
    const hidden = toPriceHistoryEntry(
      {
        id: "h1",
        old_price: 1000,
        new_price: 1150,
        source: "manual",
        changed_by: "00000000-0000-4000-9000-0000000000aa",
        changed_at: "2026-10-28T13:30:00+00:00",
      },
      new Map(),
    );
    const system = toPriceHistoryEntry(
      {
        id: "h2",
        old_price: null,
        new_price: 1000,
        source: "catalog_import",
        changed_by: null,
        changed_at: "2026-10-01T12:00:00+00:00",
      },
      new Map(),
    );

    render(<PriceHistory entries={[hidden, system]} />);

    expect(screen.getByText("Otra persona")).toBeVisible();
    expect(screen.getByText("Sistema")).toBeVisible();
    expect(screen.getByText("Importación")).toBeVisible();
    expect(screen.getByText("—")).toBeVisible();
  });

  it("muestra las 20 filas que le pasan (el límite lo pone la lectura)", () => {
    const entries = Array.from({ length: 20 }, (_, index) =>
      entry({ id: `c${index}` }),
    );

    render(<PriceHistory entries={entries} />);

    expect(screen.getAllByRole("row")).toHaveLength(21);
  });

  it("sin cambios lo dice y no dibuja la tabla", () => {
    render(<PriceHistory entries={[]} />);

    expect(screen.getByText("Todavía no hay cambios de precio.")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
