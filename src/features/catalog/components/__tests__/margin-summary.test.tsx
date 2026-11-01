import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarginSummary } from "../margin-summary";

// Spec catalog-price-editing "Margen y aviso por debajo del costo" (RN-PC-07/08).
// Los centavos de la spec: costo $ 800,00 = 80000.

const plain = (text: string) => text.replace(/ /g, " ");

describe("MarginSummary", () => {
  it("margen positivo: muestra el porcentaje y ningún aviso", () => {
    render(<MarginSummary priceCents={100000} costCents={80000} unit="unit" />);

    expect(screen.getByText("Margen: 20,0 %")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("por debajo del costo: muestra el margen negativo y el aviso con el costo", () => {
    render(<MarginSummary priceCents={75000} costCents={80000} unit="unit" />);

    expect(screen.getByText("Margen: -6,7 %")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      plain("El precio queda por debajo del costo ($ 800,00)."),
    );
  });

  it("precio igual al costo: margen 0,0 % y sin aviso", () => {
    render(<MarginSummary priceCents={80000} costCents={80000} unit="unit" />);

    expect(screen.getByText("Margen: 0,0 %")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("producto por peso: el costo del aviso lleva '/ kg'", () => {
    render(<MarginSummary priceCents={75000} costCents={80000} unit="kg" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      plain("El precio queda por debajo del costo ($ 800,00 / kg)."),
    );
  });

  it("sin costo: lo dice y no avisa", () => {
    render(<MarginSummary priceCents={75000} costCents={null} unit="unit" />);

    expect(
      screen.getByText("Sin costo: no se puede calcular el margen"),
    ).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/Margen:/)).not.toBeInTheDocument();
  });

  it("precio vacío: no muestra porcentaje ni aviso", () => {
    render(<MarginSummary priceCents={null} costCents={80000} unit="unit" />);

    expect(screen.queryByText(/Margen:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("precio cero: no hay porcentaje (no se puede dividir) pero sí el aviso, porque es menos que el costo", () => {
    render(<MarginSummary priceCents={0} costCents={80000} unit="unit" />);

    expect(screen.queryByText(/Margen:/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /por debajo del costo/,
    );
  });

  it("con la base del costo la muestra junto al monto", () => {
    render(
      <MarginSummary
        priceCents={100000}
        costCents={80000}
        costBasis="Costo de referencia (importado)"
        unit="unit"
      />,
    );

    expect(
      screen.getByText(plain("Costo de referencia (importado): $ 800,00")),
    ).toBeVisible();
  });
});
