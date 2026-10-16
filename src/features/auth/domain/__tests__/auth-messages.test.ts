import { describe, expect, it } from "vitest";

import {
  loginErrorLog,
  loginErrorMessage,
  passwordResetOutcome,
  updatePasswordErrorMessage,
} from "../auth-messages";

const INVALID_CREDENTIALS = "El email o la contraseña no son correctos.";
const TOO_MANY_ATTEMPTS =
  "Demasiados intentos. Esperá unos minutos y probá de nuevo.";
const LOGIN_GENERIC = "No pudimos iniciar sesión. Probá de nuevo en un rato.";

describe("loginErrorMessage", () => {
  it("credenciales inválidas → mensaje genérico de credenciales", () => {
    expect(loginErrorMessage("invalid_credentials", 400)).toBe(
      INVALID_CREDENTIALS,
    );
  });

  it("email sin confirmar → el mismo mensaje (no revela el estado de la cuenta)", () => {
    expect(loginErrorMessage("email_not_confirmed", 400)).toBe(
      INVALID_CREDENTIALS,
    );
  });

  it("usuario inexistente → el mismo mensaje", () => {
    expect(loginErrorMessage("user_not_found", 400)).toBe(INVALID_CREDENTIALS);
  });

  it("los tres casos de cuenta dan exactamente el mismo texto", () => {
    const messages = new Set([
      loginErrorMessage("invalid_credentials", 400),
      loginErrorMessage("email_not_confirmed", 400),
      loginErrorMessage("user_not_found", 404),
    ]);

    expect(messages.size).toBe(1);
  });

  it("HTTP 429 → demasiados intentos", () => {
    expect(loginErrorMessage("over_request_rate_limit", 429)).toBe(
      TOO_MANY_ATTEMPTS,
    );
    expect(loginErrorMessage(undefined, 429)).toBe(TOO_MANY_ATTEMPTS);
  });

  it("el 429 manda sobre el código (el límite es por IP, no habla de la cuenta)", () => {
    expect(loginErrorMessage("invalid_credentials", 429)).toBe(
      TOO_MANY_ATTEMPTS,
    );
  });

  it.each([
    ["unexpected_failure", 500],
    ["validation_failed", 422],
    ["user_banned", 400],
    [undefined, undefined],
    [undefined, 0],
    [null, null],
    ["", 500],
  ])("código %s con estado %s → mensaje genérico", (code, status) => {
    expect(loginErrorMessage(code, status)).toBe(LOGIN_GENERIC);
  });

  it("un estado 400 sin código reconocido no se confunde con credenciales", () => {
    expect(loginErrorMessage(undefined, 400)).toBe(LOGIN_GENERIC);
  });
});

describe("loginErrorLog", () => {
  // Qué registrar en el servidor tras un ingreso fallido: solo lo inesperado (la
  // rama genérica de `loginErrorMessage`), con código y estado y nada más.
  it.each([
    ["invalid_credentials", 400],
    ["email_not_confirmed", 400],
    ["user_not_found", 404],
  ])("%s (%s) es un error esperado: nada para registrar", (code, status) => {
    expect(loginErrorLog(code, status)).toBeNull();
  });

  it.each([
    ["over_request_rate_limit", 429],
    [undefined, 429],
    ["invalid_credentials", 429],
  ])("429 (%s) es el límite por IP: nada para registrar", (code, status) => {
    expect(loginErrorLog(code, status)).toBeNull();
  });

  it.each([
    ["unexpected_failure", 500, { code: "unexpected_failure", status: 500 }],
    ["validation_failed", 422, { code: "validation_failed", status: 422 }],
    ["user_banned", 400, { code: "user_banned", status: 400 }],
    [undefined, 0, { code: "unknown", status: 0 }],
    [undefined, undefined, { code: "unknown", status: null }],
    [null, null, { code: "unknown", status: null }],
  ])(
    "código %s con estado %s es inesperado: registra solo código y estado",
    (code, status, expected) => {
      expect(loginErrorLog(code, status)).toEqual(expected);
    },
  );

  it("registra exactamente cuando el mensaje es el genérico (nunca se desfasan)", () => {
    const cases: [string | null | undefined, number | null | undefined][] = [
      ["invalid_credentials", 400],
      ["email_not_confirmed", 400],
      ["user_not_found", 404],
      ["over_request_rate_limit", 429],
      ["unexpected_failure", 500],
      ["validation_failed", 422],
      [undefined, 0],
      [null, null],
      ["", 500],
    ];

    for (const [code, status] of cases) {
      expect(loginErrorLog(code, status) !== null).toBe(
        loginErrorMessage(code, status) === LOGIN_GENERIC,
      );
    }
  });
});

describe("passwordResetOutcome", () => {
  const NEUTRAL =
    "Si ese email tiene una cuenta, te mandamos un link para elegir una contraseña nueva. Revisá también el correo no deseado.";

  it("sin error → mensaje neutro y nada para registrar", () => {
    expect(passwordResetOutcome(null)).toEqual({
      message: NEUTRAL,
      log: null,
    });
  });

  it("frecuencia excedida (over_email_send_rate_limit) → el mismo mensaje neutro", () => {
    const outcome = passwordResetOutcome({
      code: "over_email_send_rate_limit",
      status: 429,
    });

    expect(outcome.message).toBe(NEUTRAL);
  });

  it.each([
    [{ code: "user_not_found", status: 404 }],
    [{ code: "unexpected_failure", status: 500 }],
    [{ code: "validation_failed", status: 422 }],
    [{ code: "something_new", status: undefined }],
    [{}],
    [{ code: null, status: null }],
  ])("error %j → siempre el mismo mensaje neutro", (error) => {
    expect(passwordResetOutcome(error).message).toBe(NEUTRAL);
  });

  it("registra solo el código y el estado del error real", () => {
    expect(
      passwordResetOutcome({ code: "over_email_send_rate_limit", status: 429 })
        .log,
    ).toEqual({ code: "over_email_send_rate_limit", status: 429 });
    expect(passwordResetOutcome({}).log).toEqual({
      code: "unknown",
      status: null,
    });
    expect(passwordResetOutcome({ code: null, status: null }).log).toEqual({
      code: "unknown",
      status: null,
    });
  });

  it("lo registrado nunca incluye el mensaje del error, que podría traer el email", () => {
    const error = {
      code: "over_email_send_rate_limit",
      status: 429,
      message: "Rate limit exceeded for duena@kiosco.test",
    };

    const { log } = passwordResetOutcome(error);

    expect(JSON.stringify(log)).not.toContain("duena@kiosco.test");
    expect(log).toEqual({ code: "over_email_send_rate_limit", status: 429 });
  });
});

describe("updatePasswordErrorMessage", () => {
  it("same_password → pide una contraseña distinta", () => {
    expect(updatePasswordErrorMessage("same_password")).toBe(
      "Elegí una contraseña distinta de la anterior.",
    );
  });

  it("weak_password → pide probar con otra", () => {
    expect(updatePasswordErrorMessage("weak_password")).toBe(
      "Esa contraseña es muy fácil de adivinar. Probá con otra.",
    );
  });

  it.each([
    "unexpected_failure",
    "over_request_rate_limit",
    "",
    undefined,
    null,
  ])("código %s → mensaje genérico", (code) => {
    expect(updatePasswordErrorMessage(code)).toBe(
      "No pudimos guardar tu contraseña. Probá de nuevo en un rato.",
    );
  });
});
