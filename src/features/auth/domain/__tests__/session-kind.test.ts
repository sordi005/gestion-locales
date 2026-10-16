import { describe, expect, expectTypeOf, it } from "vitest";

import { classifySession, readSession } from "../session-kind";
import type { SessionKind } from "../session-kind";

// `timestamp` del `amr` es en SEGUNDOS desde epoch (igual que `iat`); `now` es
// un `Date`, así que no hay forma de mezclar segundos con milisegundos.
const NOW = new Date("2026-10-15T12:00:00.000Z");
const NOW_SECONDS = NOW.getTime() / 1000;

type AmrEntry = { method: string; timestamp?: number };

/** Método del `amr` nacido hace `ageSeconds` segundos (sin timestamp si se omite). */
function method(name: string, ageSeconds?: number): AmrEntry {
  return ageSeconds === undefined
    ? { method: name }
    : { method: name, timestamp: NOW_SECONDS - ageSeconds };
}

function claimsWith(amr: unknown, extra: Record<string, unknown> = {}) {
  return { sub: "9c2f0c1e-user", email: "owner@e2e.test", amr, ...extra };
}

const MINUTE = 60;

describe("classifySession", () => {
  describe("sesión completa (password)", () => {
    it("el ingreso con contraseña es full, sin importar cuánto hace", () => {
      expect(classifySession(claimsWith([method("password", 5)]), NOW)).toBe(
        "full",
      );
      expect(
        classifySession(claimsWith([method("password", 90 * 24 * 3600)]), NOW),
      ).toBe("full");
    });

    it("password sin timestamp sigue siendo full", () => {
      expect(classifySession(claimsWith([method("password")]), NOW)).toBe(
        "full",
      );
    });

    it("password junto con un método desconocido (ej. un segundo factor) es full", () => {
      expect(
        classifySession(
          claimsWith([method("password", 60), method("totp", 30)]),
          NOW,
        ),
      ).toBe("full");
    });
  });

  describe("sesión de definir contraseña (link por email)", () => {
    // `otp` es lo que emite `verifyOtp` (flujo de /auth/confirm) y `recovery` el
    // canje PKCE de /auth/callback; `invite` y `magiclink` quedan por si GoTrue
    // los informa así (verificado en la tarea 1.8).
    it.each(["otp", "recovery", "invite", "magiclink"])(
      "%s a 1 minuto → password-setup",
      (linkMethod) => {
        expect(
          classifySession(claimsWith([method(linkMethod, MINUTE)]), NOW),
        ).toBe("password-setup");
      },
    );

    it.each(["otp", "recovery", "invite", "magiclink"])(
      "%s recién creado (0 segundos) → password-setup",
      (linkMethod) => {
        expect(classifySession(claimsWith([method(linkMethod, 0)]), NOW)).toBe(
          "password-setup",
        );
      },
    );

    it("a los 14:59 sigue siendo password-setup", () => {
      expect(
        classifySession(claimsWith([method("otp", 14 * MINUTE + 59)]), NOW),
      ).toBe("password-setup");
    });

    it("a los 15:00 en punto ya venció", () => {
      expect(
        classifySession(claimsWith([method("otp", 15 * MINUTE)]), NOW),
      ).toBe("password-setup-expired");
    });

    it("el límite se mide con precisión de milisegundos", () => {
      expect(
        classifySession(claimsWith([method("otp", 15 * MINUTE - 0.001)]), NOW),
      ).toBe("password-setup");
      expect(
        classifySession(claimsWith([method("otp", 15 * MINUTE + 0.001)]), NOW),
      ).toBe("password-setup-expired");
    });

    it.each([16 * MINUTE, 3600, 24 * 3600])(
      "con %s segundos de antigüedad está vencida",
      (age) => {
        expect(
          classifySession(claimsWith([method("recovery", age)]), NOW),
        ).toBe("password-setup-expired");
      },
    );

    it("sin timestamp no se puede saber cuándo nació: vencida", () => {
      expect(classifySession(claimsWith([method("otp")]), NOW)).toBe(
        "password-setup-expired",
      );
      expect(classifySession(claimsWith([method("recovery")]), NOW)).toBe(
        "password-setup-expired",
      );
    });

    it("un timestamp apenas en el futuro (desfasaje de relojes) no la vence", () => {
      expect(classifySession(claimsWith([method("otp", -30)]), NOW)).toBe(
        "password-setup",
      );
    });

    it("el reloj lo da el parámetro now: el mismo claim vence con otro Date", () => {
      const claims = claimsWith([method("otp", 0)]);
      const fourteenMinutesLater = new Date(NOW.getTime() + 14 * 60_000);
      const fifteenMinutesLater = new Date(NOW.getTime() + 15 * 60_000);

      expect(classifySession(claims, fourteenMinutesLater)).toBe(
        "password-setup",
      );
      expect(classifySession(claims, fifteenMinutesLater)).toBe(
        "password-setup-expired",
      );
    });
  });

  describe("password junto con un método de link: gana el más restrictivo", () => {
    it("password + recovery reciente → password-setup", () => {
      expect(
        classifySession(
          claimsWith([method("password", 10 * 3600), method("recovery", 60)]),
          NOW,
        ),
      ).toBe("password-setup");
    });

    it("password + recovery vencido → password-setup-expired", () => {
      expect(
        classifySession(
          claimsWith([method("password", 60), method("recovery", 2 * 3600)]),
          NOW,
        ),
      ).toBe("password-setup-expired");
    });

    it("el orden de los métodos no cambia el resultado", () => {
      expect(
        classifySession(
          claimsWith([method("otp", 60), method("password", 60)]),
          NOW,
        ),
      ).toBe("password-setup");
    });

    it("dos métodos de link: si alguno venció, la sesión está vencida", () => {
      expect(
        classifySession(
          claimsWith([method("otp", 60), method("recovery", 2 * 3600)]),
          NOW,
        ),
      ).toBe("password-setup-expired");
    });

    it("un método desconocido no le quita el vencimiento al link", () => {
      expect(
        classifySession(
          claimsWith([method("totp", 10), method("otp", 20 * MINUTE)]),
          NOW,
        ),
      ).toBe("password-setup-expired");
    });
  });

  describe("sin sesión utilizable (none)", () => {
    it.each(["oauth", "anonymous", "sso/saml", "totp", "phone"])(
      "solo %s → none (la app no ofrece ese método)",
      (unknownMethod) => {
        expect(
          classifySession(claimsWith([method(unknownMethod, 5)]), NOW),
        ).toBe("none");
      },
    );

    it("varios métodos desconocidos y ninguno conocido → none", () => {
      expect(
        classifySession(
          claimsWith([method("oauth", 5), method("anonymous", 5)]),
          NOW,
        ),
      ).toBe("none");
    });

    it("amr vacío → none", () => {
      expect(classifySession(claimsWith([]), NOW)).toBe("none");
    });

    it("sin amr → none", () => {
      expect(
        classifySession({ sub: "9c2f0c1e-user", email: "a@e2e.test" }, NOW),
      ).toBe("none");
    });

    it.each([
      ["null", null],
      ["undefined", undefined],
      ["un texto", "password"],
      ["un número", 42],
      ["una lista", [{ method: "password" }]],
      ["un objeto vacío", {}],
    ])("claims %s → none", (_label, claims) => {
      expect(classifySession(claims, NOW)).toBe("none");
    });

    it.each([
      ["null", null],
      ["un texto", "password"],
      ["un objeto", { method: "password" }],
      ["un número", 1],
    ])("amr %s (no es una lista) → none", (_label, amr) => {
      expect(classifySession(claimsWith(amr), NOW)).toBe("none");
    });

    it.each([
      ["una entrada null", [null]],
      ["un texto suelto (formato viejo)", ["pwd"]],
      ["una entrada sin method", [{ timestamp: NOW_SECONDS }]],
      ["un method que no es texto", [{ method: 5, timestamp: NOW_SECONDS }]],
      [
        "un timestamp que no es número",
        [{ method: "password", timestamp: "ayer" }],
      ],
      ["un timestamp null", [{ method: "password", timestamp: null }]],
      [
        "una entrada mal formada junto a una buena",
        [method("password", 5), { method: null }],
      ],
    ])("amr con %s → none (falla cerrado)", (_label, amr) => {
      expect(classifySession(claimsWith(amr), NOW)).toBe("none");
    });

    it("claims sin sub (sin identidad) → none aunque el amr diga password", () => {
      expect(
        classifySession(
          { amr: [method("password", 5)], email: "a@e2e.test" },
          NOW,
        ),
      ).toBe("none");
      expect(
        classifySession(claimsWith([method("password", 5)], { sub: "" }), NOW),
      ).toBe("none");
    });
  });

  // Una sola definición de "identidad válida" para el proxy (`classifySession`) y
  // para el servidor (`getAuthState` usa `readSession`): si una de las dos aceptara
  // una sesión que la otra rechaza, `/` y `/login` se redirigirían entre sí en bucle.
  describe("identidad completa: sub y email no vacíos", () => {
    it.each([
      ["password", [method("password", 5)]],
      ["un link reciente", [method("otp", 60)]],
      ["un link vencido", [method("otp", 20 * MINUTE)]],
    ])(
      "una sesión de %s sin email → none (igual que en el servidor)",
      (_label, amr) => {
        expect(classifySession({ sub: "9c2f0c1e-user", amr }, NOW)).toBe(
          "none",
        );
      },
    );

    it.each([
      ["vacío", ""],
      ["null", null],
      ["un número", 5],
    ])("email %s → none", (_label, email) => {
      expect(
        classifySession(claimsWith([method("password", 5)], { email }), NOW),
      ).toBe("none");
    });

    it("con sub y email la sesión sigue clasificándose igual", () => {
      expect(classifySession(claimsWith([method("password", 5)]), NOW)).toBe(
        "full",
      );
      expect(classifySession(claimsWith([method("otp", 60)]), NOW)).toBe(
        "password-setup",
      );
    });
  });

  describe("readSession", () => {
    it("una sesión completa devuelve su tipo y la identidad (sub y email)", () => {
      expect(readSession(claimsWith([method("password", 5)]), NOW)).toEqual({
        kind: "full",
        user: { id: "9c2f0c1e-user", email: "owner@e2e.test" },
      });
    });

    it("una sesión de definir contraseña (vigente o vencida) también trae la identidad", () => {
      expect(readSession(claimsWith([method("otp", 60)]), NOW)).toEqual({
        kind: "password-setup",
        user: { id: "9c2f0c1e-user", email: "owner@e2e.test" },
      });
      expect(
        readSession(claimsWith([method("otp", 20 * MINUTE)]), NOW),
      ).toEqual({
        kind: "password-setup-expired",
        user: { id: "9c2f0c1e-user", email: "owner@e2e.test" },
      });
    });

    it.each([
      ["sin email", claimsWith([method("password", 5)], { email: undefined })],
      ["con email vacío", claimsWith([method("password", 5)], { email: "" })],
      ["sin sub", claimsWith([method("password", 5)], { sub: undefined })],
      ["con un método que la app no ofrece", claimsWith([method("oauth", 5)])],
      ["sin claims", null],
    ])("%s → none y sin usuario", (_label, claims) => {
      expect(readSession(claims, NOW)).toEqual({ kind: "none", user: null });
    });

    it("el tipo de sesión coincide siempre con classifySession", () => {
      const samples = [
        claimsWith([method("password", 5)]),
        claimsWith([method("otp", 60)]),
        claimsWith([method("otp", 20 * MINUTE)]),
        claimsWith([method("password", 5)], { email: "" }),
        claimsWith([method("oauth", 5)]),
        null,
      ];

      for (const claims of samples) {
        expect(readSession(claims, NOW).kind).toBe(
          classifySession(claims, NOW),
        );
      }
    });
  });

  it("devuelve siempre un SessionKind", () => {
    expectTypeOf(classifySession(null, NOW)).toEqualTypeOf<SessionKind>();
    expectTypeOf<SessionKind>().toEqualTypeOf<
      "none" | "full" | "password-setup" | "password-setup-expired"
    >();
  });
});
