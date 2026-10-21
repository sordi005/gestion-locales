import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AutoSubmit } from "../auto-submit";

// `/auth/sin-acceso` (D8): el formulario con "Volver al ingreso" funciona solo, sin
// JavaScript; este componente mínimo lo envía una vez al montarse. El doble efecto
// de StrictMode (y cualquier re-render) no puede mandar la acción dos veces.

function Harness({ onSubmit }: { onSubmit: () => void }) {
  return (
    <form
      aria-label="salida"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <button type="submit">Volver al ingreso</button>
      <AutoSubmit />
    </form>
  );
}

describe("AutoSubmit", () => {
  it("envía el formulario que lo contiene al montarse", () => {
    const onSubmit = vi.fn();

    render(<Harness onSubmit={onSubmit} />);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("lo envía UNA sola vez aunque el efecto corra dos veces (StrictMode)", () => {
    const onSubmit = vi.fn();

    render(
      <StrictMode>
        <Harness onSubmit={onSubmit} />
      </StrictMode>,
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("un re-render no lo vuelve a enviar", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Harness onSubmit={onSubmit} />);

    rerender(<Harness onSubmit={onSubmit} />);
    rerender(<Harness onSubmit={onSubmit} />);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("solo envía su propio formulario, no otro de la página", () => {
    const own = vi.fn();
    const other = vi.fn();

    render(
      <>
        <form
          aria-label="otro"
          onSubmit={(event) => {
            event.preventDefault();
            other();
          }}
        >
          <button type="submit">Otro</button>
        </form>
        <Harness onSubmit={own} />
      </>,
    );

    expect(own).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("antes de enviar (y sin JavaScript) no afirma nada: el aviso de estado está vacío", () => {
    // Sin el efecto (sin JavaScript) el servidor entrega este mismo HTML: el
    // aviso no puede decir "Cerrando sesión…" si nada se está cerrando.
    render(<Harness onSubmit={() => {}} />);

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByText("Cerrando sesión…")).not.toBeInTheDocument();
  });

  it("dice 'Cerrando sesión…' mientras la acción del formulario está en curso y lo borra al terminar", async () => {
    let finish: () => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    render(
      <form aria-label="salida" action={action}>
        <button type="submit">Volver al ingreso</button>
        <AutoSubmit />
      </form>,
    );

    expect(await screen.findByText("Cerrando sesión…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Cerrando sesión…");
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => finish());

    expect(screen.queryByText("Cerrando sesión…")).not.toBeInTheDocument();
  });

  it("fuera de un formulario no hace nada (y no falla)", () => {
    expect(() => render(<AutoSubmit />)).not.toThrow();
  });
});
