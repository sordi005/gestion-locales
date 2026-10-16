import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import {
  callbackCodeSchema,
  linkParamsSchema,
  loginSchema,
  newPasswordSchema,
  passwordResetRequestSchema,
} from "../schemas";

/** Errores como `[campo, mensaje]`, para comparar sin atarse al formato de Zod. */
function errorsOf(schema: ZodType, input: unknown): [string, string][] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => [
    issue.path.join("."),
    issue.message,
  ]);
}

describe("loginSchema", () => {
  it("acepta email y contraseña", () => {
    const result = loginSchema.safeParse({
      email: "owner.norte@demo.test",
      password: "Demo-Local-2026!",
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      email: "owner.norte@demo.test",
      password: "Demo-Local-2026!",
    });
  });

  it("recorta los espacios del email pero no toca la contraseña", () => {
    const result = loginSchema.safeParse({
      email: "  duena@kiosco.test \n",
      password: " con espacios ",
    });

    expect(result.data).toEqual({
      email: "duena@kiosco.test",
      password: " con espacios ",
    });
  });

  it("no exige el mínimo de 8 caracteres al ingresar (contraseñas viejas)", () => {
    expect(
      loginSchema.safeParse({ email: "a@kiosco.test", password: "abc" })
        .success,
    ).toBe(true);
  });

  it.each([
    ["vacío", ""],
    ["solo espacios", "   "],
    ["ausente", undefined],
    ["null (FormData sin el campo)", null],
    ["no es texto", 42],
  ])("email %s → pide escribir el email", (_label, email) => {
    expect(errorsOf(loginSchema, { email, password: "secreta123" })).toEqual([
      ["email", "Escribí tu email."],
    ]);
  });

  it.each([
    "no-es-un-email",
    "sin-dominio@",
    "@sin-usuario.test",
    "con espacio@kiosco.test",
    "dos@@kiosco.test",
  ])("email %j → pide un email válido", (email) => {
    expect(errorsOf(loginSchema, { email, password: "secreta123" })).toEqual([
      ["email", "Escribí un email válido."],
    ]);
  });

  it.each([
    ["vacía", ""],
    ["ausente", undefined],
    ["null", null],
  ])("contraseña %s → pide escribir la contraseña", (_label, password) => {
    expect(errorsOf(loginSchema, { email: "a@kiosco.test", password })).toEqual(
      [["password", "Escribí tu contraseña."]],
    );
  });

  it("con los dos campos mal informa los dos", () => {
    expect(errorsOf(loginSchema, { email: "", password: "" })).toEqual([
      ["email", "Escribí tu email."],
      ["password", "Escribí tu contraseña."],
    ]);
  });
});

describe("passwordResetRequestSchema", () => {
  it("acepta un email válido y lo recorta", () => {
    expect(
      passwordResetRequestSchema.safeParse({ email: " duena@kiosco.test " })
        .data,
    ).toEqual({ email: "duena@kiosco.test" });
  });

  it("email vacío → pide escribirlo", () => {
    expect(errorsOf(passwordResetRequestSchema, { email: "" })).toEqual([
      ["email", "Escribí tu email."],
    ]);
  });

  it("email inválido → pide uno válido", () => {
    expect(
      errorsOf(passwordResetRequestSchema, { email: "no-es-un-email" }),
    ).toEqual([["email", "Escribí un email válido."]]);
  });
});

describe("linkParamsSchema", () => {
  const INVALID_LINK = "El link no es válido.";

  it.each(["invite", "recovery"] as const)(
    "acepta un token_hash con type=%s",
    (type) => {
      expect(
        linkParamsSchema.safeParse({ token_hash: "pkce_a1B2-c3_D4", type })
          .data,
      ).toEqual({ token_hash: "pkce_a1B2-c3_D4", type });
    },
  );

  it("acepta un hash hexadecimal de 56 caracteres y el largo máximo de 256", () => {
    expect(
      linkParamsSchema.safeParse({
        token_hash: "a".repeat(56),
        type: "recovery",
      }).success,
    ).toBe(true);
    expect(
      linkParamsSchema.safeParse({
        token_hash: "a".repeat(256),
        type: "recovery",
      }).success,
    ).toBe(true);
  });

  it("rechaza un token_hash de 257 caracteres", () => {
    expect(
      errorsOf(linkParamsSchema, {
        token_hash: "a".repeat(257),
        type: "recovery",
      }),
    ).toEqual([["token_hash", INVALID_LINK]]);
  });

  it.each([
    ["vacío", ""],
    ["ausente", undefined],
    ["null", null],
    ["con espacio", "abc def"],
    ["con barra", "abc/def"],
    ["con punto", "abc.def"],
    ["con igual", "abc="],
    ["con porcentaje", "abc%20def"],
    ["con etiqueta", "<script>alert(1)</script>"],
    ["con salto de línea", "abc\ndef"],
    ["con tilde", "contraseñ"],
    ["no es texto", 12345],
  ])("token_hash %s → link inválido", (_label, token_hash) => {
    expect(
      errorsOf(linkParamsSchema, { token_hash, type: "recovery" }),
    ).toEqual([["token_hash", INVALID_LINK]]);
  });

  it.each([
    ["signup", "signup"],
    ["magiclink", "magiclink"],
    ["email_change", "email_change"],
    ["en mayúsculas", "RECOVERY"],
    ["vacío", ""],
    ["ausente", undefined],
    ["null", null],
  ])("type %s → link inválido", (_label, type) => {
    expect(errorsOf(linkParamsSchema, { token_hash: "abc123", type })).toEqual([
      ["type", INVALID_LINK],
    ]);
  });

  it("con todo mal informa los dos campos", () => {
    expect(errorsOf(linkParamsSchema, {})).toEqual([
      ["token_hash", INVALID_LINK],
      ["type", INVALID_LINK],
    ]);
  });
});

describe("callbackCodeSchema", () => {
  it.each([
    "6f1c2a9e-83b4-4d57-9a1e-0c5d2b7e4f10", // UUID, como lo emite GoTrue
    "a1B2_c3-D4",
    "a".repeat(256),
  ])("acepta el código %s", (code) => {
    expect(callbackCodeSchema.safeParse(code).success).toBe(true);
  });

  it.each([
    ["vacío", ""],
    ["ausente", undefined],
    ["null (parámetro ausente en la URL)", null],
    ["no es texto", 42],
    ["con espacios", "abc def"],
    ["con caracteres especiales", "abc'; drop table--"],
    ["con una barra (no es un código)", "abc/def"],
    ["de más de 256 caracteres", "a".repeat(257)],
  ])("rechaza el código %s", (_label, code) => {
    expect(callbackCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe("newPasswordSchema", () => {
  const TOO_SHORT = "La contraseña tiene que tener al menos 8 caracteres.";
  const TOO_LONG = "La contraseña es demasiado larga.";
  const MISMATCH = "Las contraseñas no coinciden.";

  const same = (password: string) => ({ password, confirmPassword: password });

  describe("largo mínimo: 8 caracteres", () => {
    it("7 caracteres → al menos 8", () => {
      expect(errorsOf(newPasswordSchema, same("abcdefg"))).toEqual([
        ["password", TOO_SHORT],
      ]);
    });

    it("contraseña vacía → al menos 8", () => {
      expect(errorsOf(newPasswordSchema, same(""))).toEqual([
        ["password", TOO_SHORT],
      ]);
    });

    it("8 caracteres se acepta, sin exigir números, símbolos ni mayúsculas", () => {
      expect(newPasswordSchema.safeParse(same("abcdefgh")).success).toBe(true);
    });

    it("cuenta caracteres y no unidades UTF-16: 4 emojis son 4 caracteres", () => {
      expect(errorsOf(newPasswordSchema, same("😀😀😀😀"))).toEqual([
        ["password", TOO_SHORT],
      ]);
      expect(newPasswordSchema.safeParse(same("😀".repeat(8))).success).toBe(
        true,
      );
    });

    it("no recorta espacios: cuentan como caracteres", () => {
      expect(newPasswordSchema.safeParse(same(" abcdefg")).success).toBe(true);
      expect(newPasswordSchema.safeParse(same("abc defg")).success).toBe(true);
    });

    it("7 letras ñ (14 bytes) siguen siendo 7 caracteres", () => {
      expect(errorsOf(newPasswordSchema, same("ñ".repeat(7)))).toEqual([
        ["password", TOO_SHORT],
      ]);
    });
  });

  describe("largo máximo: 72 bytes en UTF-8 (límite de bcrypt)", () => {
    it("72 caracteres ASCII se aceptan", () => {
      expect(newPasswordSchema.safeParse(same("a".repeat(72))).success).toBe(
        true,
      );
    });

    it("73 caracteres ASCII → demasiado larga", () => {
      expect(errorsOf(newPasswordSchema, same("a".repeat(73)))).toEqual([
        ["password", TOO_LONG],
      ]);
    });

    it("37 letras ñ (74 bytes) → demasiado larga, aunque sean menos de 72 caracteres", () => {
      expect(errorsOf(newPasswordSchema, same("ñ".repeat(37)))).toEqual([
        ["password", TOO_LONG],
      ]);
    });

    it("36 letras ñ (justo 72 bytes) se aceptan", () => {
      expect(newPasswordSchema.safeParse(same("ñ".repeat(36))).success).toBe(
        true,
      );
    });

    it("18 emojis (72 bytes) se aceptan y 19 (76 bytes) no", () => {
      expect(newPasswordSchema.safeParse(same("😀".repeat(18))).success).toBe(
        true,
      );
      expect(errorsOf(newPasswordSchema, same("😀".repeat(19)))).toEqual([
        ["password", TOO_LONG],
      ]);
    });
  });

  describe("las dos contraseñas deben coincidir", () => {
    it("distintas → no coinciden, en el campo de repetir", () => {
      expect(
        errorsOf(newPasswordSchema, {
          password: "una-clave-larga",
          confirmPassword: "otra-clave-larga",
        }),
      ).toEqual([["confirmPassword", MISMATCH]]);
    });

    it("solo difieren en mayúsculas → no coinciden", () => {
      expect(
        errorsOf(newPasswordSchema, {
          password: "ClaveLarga1",
          confirmPassword: "clavelarga1",
        }),
      ).toEqual([["confirmPassword", MISMATCH]]);
    });

    it("repetir vacío → no coinciden", () => {
      expect(
        errorsOf(newPasswordSchema, {
          password: "una-clave-larga",
          confirmPassword: "",
        }),
      ).toEqual([["confirmPassword", MISMATCH]]);
    });

    it("corta y distinta informa el largo y también que no coinciden", () => {
      expect(
        errorsOf(newPasswordSchema, {
          password: "abcdefg",
          confirmPassword: "abcdefh",
        }),
      ).toEqual([
        ["password", TOO_SHORT],
        ["confirmPassword", MISMATCH],
      ]);
    });

    it("iguales y válidas devuelve ambas", () => {
      expect(newPasswordSchema.safeParse(same("una-clave-larga")).data).toEqual(
        { password: "una-clave-larga", confirmPassword: "una-clave-larga" },
      );
    });
  });

  it.each([
    ["ausente", undefined],
    ["null", null],
    ["no es texto", 12345678],
  ])("contraseña %s → pide escribirla", (_label, password) => {
    expect(
      errorsOf(newPasswordSchema, { password, confirmPassword: "abcdefgh" }),
    ).toEqual([["password", "Escribí una contraseña."]]);
  });

  it("sin el campo de repetir → pide repetirla", () => {
    expect(errorsOf(newPasswordSchema, { password: "abcdefgh" })).toEqual([
      ["confirmPassword", "Repetí la contraseña."],
    ]);
  });
});
