import { describe, expect, it } from "vitest";

import { safeNextPath } from "../safe-next-path";

describe("safeNextPath", () => {
  describe("rutas internas válidas", () => {
    it.each([
      ["/", "/"],
      ["/l/123/vender", "/l/123/vender"],
      ["/l/123/vender?tab=1", "/l/123/vender?tab=1"],
      ["/l/123/vender?tab=1&q=a%20b", "/l/123/vender?tab=1&q=a%20b"],
      ["/caja#resumen", "/caja#resumen"],
      ["/estadisticas?desde=2026-10-01", "/estadisticas?desde=2026-10-01"],
    ])("%s se acepta tal cual", (value, expected) => {
      expect(safeNextPath(value)).toBe(expected);
    });

    it("no confunde rutas que solo empiezan parecido a las de auth", () => {
      expect(safeNextPath("/authors")).toBe("/authors");
      expect(safeNextPath("/loginx")).toBe("/loginx");
      expect(safeNextPath("/login-historial")).toBe("/login-historial");
      expect(safeNextPath("/l/1/login")).toBe("/l/1/login");
      expect(safeNextPath("/recuperar-contrasena-vieja")).toBe(
        "/recuperar-contrasena-vieja",
      );
    });
  });

  describe("intentos de redirección abierta", () => {
    it.each([
      ["//evil.example", "dos barras"],
      ["//evil.example/login", "dos barras con ruta"],
      ["///evil.example", "tres barras"],
      ["/\\evil.example", "barra y barra invertida"],
      ["\\\\evil.example", "dos barras invertidas"],
      ["https://evil.example", "URL absoluta https"],
      ["http://evil.example/x", "URL absoluta http"],
      ["javascript:alert(1)", "esquema javascript"],
      ["data:text/html,<script>alert(1)</script>", "esquema data"],
      ["evil.example", "sin barra inicial"],
      ["l/123/vender", "ruta relativa"],
      [" /l/123", "espacio al inicio"],
      ["", "texto vacío"],
    ])("%s → / (%s)", (value) => {
      expect(safeNextPath(value)).toBe("/");
    });

    it("rechaza tab y salto de línea, que el navegador elimina y convertirían /<tab>/x en //x", () => {
      expect(safeNextPath("/\t/evil.example")).toBe("/");
      expect(safeNextPath("/\n/evil.example")).toBe("/");
      expect(safeNextPath("/\r/evil.example")).toBe("/");
      expect(safeNextPath("/ruta\tvalida")).toBe("/");
      expect(safeNextPath("/ruta\u0000x")).toBe("/");
      expect(safeNextPath("/ruta\u007fx")).toBe("/");
    });

    it("rechaza barras invertidas en cualquier posición", () => {
      expect(safeNextPath("/l/123\\vender")).toBe("/");
      expect(safeNextPath("/l/123/vender?x=\\evil")).toBe("/");
    });
  });

  // `redirect()` pone el destino en un header HTTP: un carácter fuera de ASCII
  // imprimible hace fallar a Node (`ERR_INVALID_CHAR`) y el ingreso termina en
  // un 500 aunque haya salido bien. Falla cerrado: solo ASCII imprimible.
  describe("solo ASCII imprimible (el destino viaja en un header)", () => {
    it.each([
      ["/€", "símbolo del euro"],
      ["/日本", "ideogramas"],
      ["/ñ", "letra con tilde"],
      ["/caja/ñandú?x=1", "tilde en medio de la ruta"],
      ["/caja?q=café", "tilde en la query"],
      ["/caja#reseña", "tilde en el fragmento"],
      ["/a b", "espacio"],
      ["/caja?x=a b", "espacio en la query"],
      ["/a\u00a0b", "espacio de no separación (NBSP)"],
      ["/a\u2028b", "separador de línea U+2028"],
      ["/a\u2029b", "separador de párrafo U+2029"],
      ["/a\u200bb", "espacio de ancho cero"],
      ["/a\u0085b", "siguiente línea (NEL, control C1)"],
      ["/😀", "emoji (par sustituto)"],
    ])("%s → / (%s)", (value) => {
      expect(safeNextPath(value)).toBe("/");
    });

    it("lo mismo codificado con %xx sigue aceptándose: es ASCII", () => {
      expect(safeNextPath("/%E2%82%AC")).toBe("/%E2%82%AC");
      expect(safeNextPath("/caja?q=caf%C3%A9")).toBe("/caja?q=caf%C3%A9");
      expect(safeNextPath("/a%20b")).toBe("/a%20b");
    });

    it("acepta todo el ASCII imprimible que no es barra invertida", () => {
      const printable = "/!\"#$%&'()*+,-./0123456789:;<=>?@AZaz[]^_`{|}~";

      expect(safeNextPath(printable)).toBe(printable);
    });
  });

  describe("valores que no son texto", () => {
    it.each([
      [undefined],
      [null],
      [42],
      [true],
      [["/caja"]],
      [{ toString: () => "/caja" }],
    ])("%s → /", (value) => {
      expect(safeNextPath(value)).toBe("/");
    });
  });

  describe("sin bucles hacia las pantallas de auth", () => {
    it.each([
      "/login",
      "/login?next=/caja",
      "/login/",
      "/login#x",
      "/recuperar-contrasena",
      "/recuperar-contrasena?error=link",
      "/actualizar-contrasena",
      "/actualizar-contrasena/",
      "/auth",
      "/auth/",
      "/auth/confirm",
      "/auth/confirm?token_hash=abc&type=recovery",
      "/auth/callback?code=x",
    ])("%s → /", (value) => {
      expect(safeNextPath(value)).toBe("/");
    });

    it("rechaza las rutas de auth escondidas con puntos o codificadas", () => {
      expect(safeNextPath("/caja/../login")).toBe("/");
      expect(safeNextPath("/./login")).toBe("/");
      expect(safeNextPath("/%6Cogin")).toBe("/");
      expect(safeNextPath("/auth%2Fcallback")).toBe("/");
      expect(safeNextPath("/%E0%A4%A")).toBe("/");
    });
  });
});
