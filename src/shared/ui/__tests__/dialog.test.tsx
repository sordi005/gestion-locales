import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

// Toda la interfaz es en español (voseo): los botones de cerrar del diálogo
// compartido también. Un lector de pantalla no debe oír "Close".

function renderDialog(footerClose: boolean) {
  render(
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Título</DialogTitle>
          <DialogDescription>Descripción</DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton={footerClose} />
      </DialogContent>
    </Dialog>,
  );
}

describe("Dialog: textos en español", () => {
  it("el botón de la esquina se llama 'Cerrar' para un lector de pantalla", () => {
    renderDialog(false);

    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
  });

  it("con el botón del pie, ese también dice 'Cerrar' (y no queda ninguno en inglés)", () => {
    renderDialog(true);

    expect(screen.getAllByRole("button", { name: "Cerrar" })).toHaveLength(2);
    expect(screen.queryByText("Close")).not.toBeInTheDocument();
  });
});
