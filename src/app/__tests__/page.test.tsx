import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Page from "@/app/page";

describe("página de inicio", () => {
  it("muestra el nombre del producto como encabezado principal", () => {
    render(<Page />);

    expect(
      screen.getByRole("heading", { level: 1, name: "[NOMBRE-PRODUCTO]" }),
    ).toBeInTheDocument();
  });

  it("informa en español que el producto está en construcción", () => {
    render(<Page />);

    expect(screen.getByText("En construcción")).toBeVisible();
  });
});
