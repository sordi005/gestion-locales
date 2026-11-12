import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runSharedProductConsensus } from "../actions";
import { RunConsensusButton } from "../components/run-consensus-button";

// Spec shared-product-review: un botón para correr la promoción por consenso a mano.
// Dice cuántos códigos entraron a la base.

vi.mock("../actions", () => ({ runSharedProductConsensus: vi.fn() }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

beforeEach(() => {
  vi.mocked(runSharedProductConsensus).mockReset();
  refresh.mockReset();
});

describe("RunConsensusButton", () => {
  it.each([
    [0, "No había códigos para promover."],
    [1, "Se promovió 1 código a la base."],
    [3, "Se promovieron 3 códigos a la base."],
  ])("con %i promovidos avisa: %s", async (count, message) => {
    vi.mocked(runSharedProductConsensus).mockResolvedValue({
      ok: true,
      value: count,
    });
    const user = userEvent.setup();
    render(<RunConsensusButton />);

    await user.click(
      screen.getByRole("button", { name: "Correr la promoción" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(message);
    expect(refresh).toHaveBeenCalled();
  });

  it("si la corrida se salteó porque ya había otra, lo avisa y no dice que no había nada", async () => {
    vi.mocked(runSharedProductConsensus).mockResolvedValue({
      ok: true,
      value: null,
    });
    const user = userEvent.setup();
    render(<RunConsensusButton />);

    await user.click(
      screen.getByRole("button", { name: "Correr la promoción" }),
    );

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "Ya hay una promoción corriendo. Probá de nuevo en un rato.",
    );
    expect(status).not.toHaveTextContent("No había códigos");
  });

  it("si falla muestra el error en una alerta y no refresca", async () => {
    vi.mocked(runSharedProductConsensus).mockResolvedValue({
      ok: false,
      error: { code: "SP-A05", message: "No se pudo completar." },
    });
    const user = userEvent.setup();
    render(<RunConsensusButton />);

    await user.click(
      screen.getByRole("button", { name: "Correr la promoción" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo completar.",
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
