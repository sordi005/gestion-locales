import { render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConfirmPage, { metadata } from "@/app/auth/confirm/page";
import { createClient } from "@/shared/db/server";

// Spec auth-password-links "Confirmación del link en dos pasos": el GET de
// `/auth/confirm` valida los parámetros con Zod y muestra "Continuar" SIN llamar
// a Supabase (un antivirus que abre el link no lo gasta); con parámetros
// inválidos lleva al aviso de link inválido; declara `referrer: no-referrer`.

vi.mock("@/features/auth/actions", () => ({ confirmLink: vi.fn() }));
vi.mock("@/shared/db/server");
vi.mock("next/navigation", () => ({
  // Como el real, `redirect` no vuelve: lanza para cortar el render.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const TOKEN_HASH = "pkce_3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c";

async function renderPage(
  searchParams: Record<string, string | string[] | undefined>,
) {
  render(
    await ConfirmPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(redirect).mockClear();
});

describe("página /auth/confirm: GET con parámetros válidos", () => {
  it("recupero: muestra el texto del tipo y Continuar, sin llamar a Supabase", async () => {
    await renderPage({ token_hash: TOKEN_HASH, type: "recovery" });

    expect(
      screen.getByText("Tocá Continuar para elegir una contraseña nueva."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continuar" }),
    ).toBeInTheDocument();
    expect(createClient).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("invitación: muestra el texto del tipo y Continuar, sin llamar a Supabase", async () => {
    await renderPage({ token_hash: TOKEN_HASH, type: "invite" });

    expect(
      screen.getByText(
        "Te invitaron a [NOMBRE-PRODUCTO]. Tocá Continuar para crear tu contraseña.",
      ),
    ).toBeInTheDocument();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("pone el token y el tipo en el formulario que se enviará al tocar Continuar", async () => {
    await renderPage({ token_hash: TOKEN_HASH, type: "recovery" });

    const form = screen
      .getByRole("button", { name: "Continuar" })
      .closest("form") as HTMLFormElement;
    expect(form.querySelector('input[name="token_hash"]')).toHaveValue(
      TOKEN_HASH,
    );
    expect(form.querySelector('input[name="type"]')).toHaveValue("recovery");
  });

  it("con un parámetro repetido toma el primero", async () => {
    await renderPage({
      token_hash: [TOKEN_HASH, "otro"],
      type: ["recovery", "invite"],
    });

    const form = screen
      .getByRole("button", { name: "Continuar" })
      .closest("form") as HTMLFormElement;
    expect(form.querySelector('input[name="token_hash"]')).toHaveValue(
      TOKEN_HASH,
    );
    expect(form.querySelector('input[name="type"]')).toHaveValue("recovery");
  });
});

describe("página /auth/confirm: GET con parámetros inválidos", () => {
  it.each([
    { caso: "sin parámetros", params: {} },
    { caso: "sin token_hash", params: { type: "recovery" } },
    { caso: "sin type", params: { token_hash: TOKEN_HASH } },
    {
      caso: "type=signup",
      params: { token_hash: TOKEN_HASH, type: "signup" },
    },
    {
      caso: "caracteres no permitidos en el token",
      params: { token_hash: "abc<script>", type: "recovery" },
    },
    {
      caso: "token_hash demasiado largo",
      params: { token_hash: "a".repeat(257), type: "recovery" },
    },
    {
      caso: "token_hash vacío",
      params: { token_hash: "", type: "recovery" },
    },
  ])(
    "$caso: va al aviso de link inválido sin llamar a Supabase",
    async ({ params }) => {
      await expect(renderPage(params)).rejects.toThrow(
        "NEXT_REDIRECT:/recuperar-contrasena?error=link",
      );

      expect(createClient).not.toHaveBeenCalled();
    },
  );
});

describe("metadata de /auth/confirm", () => {
  it("declara referrer no-referrer (el token viaja en la URL)", () => {
    expect(metadata.referrer).toBe("no-referrer");
  });
});
