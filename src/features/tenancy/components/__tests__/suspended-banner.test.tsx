import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PRODUCT_NAME } from "@/shared/lib/brand";

import { SuspendedBanner } from "../suspended-banner";

// Spec app-shell "Aviso de organización suspendida en el marco": el texto exacto,
// con el nombre de la organización y `PRODUCT_NAME`, con rol `status`.

describe("SuspendedBanner", () => {
  it("muestra el texto de la spec con la organización y el nombre del producto", () => {
    render(<SuspendedBanner organizationName="Kiosco Demo Norte" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      `La cuenta de Kiosco Demo Norte está suspendida: podés consultar tus datos, pero no cargar ventas ni cambios. Para reactivarla, comunicate con ${PRODUCT_NAME}.`,
    );
  });

  it("usa el nombre de la organización que recibe, sea cual sea", () => {
    render(<SuspendedBanner organizationName="Almacén Demo Sur" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "La cuenta de Almacén Demo Sur está suspendida",
    );
    expect(screen.queryByText(/Kiosco Demo Norte/)).not.toBeInTheDocument();
  });

  it("es visible", () => {
    render(<SuspendedBanner organizationName="Kiosco" />);

    expect(screen.getByRole("status")).toBeVisible();
  });
});
