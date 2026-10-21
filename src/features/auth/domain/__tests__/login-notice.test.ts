import { describe, expect, it } from "vitest";

import { loginNoticeFromAviso } from "../login-notice";

// `/login?aviso=…` muestra un aviso solo si el valor es EXACTAMENTE uno de los
// conocidos. Cualquier otro valor (incluidas las claves heredadas de Object, como
// `toString`) no muestra nada: el parámetro viene de la URL y no es de fiar.

describe("loginNoticeFromAviso", () => {
  it("contrasena-actualizada → aviso de contraseña guardada", () => {
    expect(loginNoticeFromAviso("contrasena-actualizada")).toBe(
      "password-saved",
    );
  });

  it("sin-acceso → aviso de falta de acceso", () => {
    expect(loginNoticeFromAviso("sin-acceso")).toBe("no-access");
  });

  it.each([
    undefined,
    "",
    "otro",
    "SIN-ACCESO",
    "sin-acceso ",
    "toString",
    "__proto__",
    "constructor",
  ])("%j no muestra ningún aviso", (value) => {
    expect(loginNoticeFromAviso(value)).toBeUndefined();
  });
});
