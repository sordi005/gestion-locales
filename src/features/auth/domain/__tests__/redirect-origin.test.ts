import { describe, expect, it } from "vitest";

import { resolveRedirectOrigin } from "../redirect-origin";

const SITE_URL = "https://app.example.com";

describe("resolveRedirectOrigin", () => {
  describe("usa el header Origin cuando es un origen http(s) válido", () => {
    it.each([
      "https://pr-12-equipo.vercel.app",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://staging.example.com:8443",
    ])("%s", (origin) => {
      expect(
        resolveRedirectOrigin({ originHeader: origin, siteUrl: SITE_URL }),
      ).toBe(origin);
    });
  });

  describe("cae en el origen de siteUrl", () => {
    it.each([
      ["ausente (null)", null],
      ["ausente (undefined)", undefined],
      ["vacío", ""],
      ["solo espacios", "   "],
      ["el texto null de un origen opaco", "null"],
      ["no es una URL", "esto no es una url"],
      ["sin esquema", "pr-12-equipo.vercel.app"],
      ["esquema javascript", "javascript:alert(1)"],
      ["esquema ftp", "ftp://files.example.com"],
      ["esquema file", "file:///etc/passwd"],
      ["con ruta", "https://pr-12-equipo.vercel.app/login"],
      ["con barra final", "https://pr-12-equipo.vercel.app/"],
      ["con query", "https://pr-12-equipo.vercel.app?x=1"],
      ["con credenciales", "https://user:pass@pr-12-equipo.vercel.app"],
      ["con mayúsculas (no es un Origin serializado)", "HTTPS://Evil.Example"],
    ])("Origin %s", (_label, originHeader) => {
      expect(resolveRedirectOrigin({ originHeader, siteUrl: SITE_URL })).toBe(
        SITE_URL,
      );
    });
  });

  describe("el origen de siteUrl", () => {
    it("descarta la ruta de siteUrl", () => {
      expect(
        resolveRedirectOrigin({
          originHeader: undefined,
          siteUrl: "https://app.example.com/base/path",
        }),
      ).toBe("https://app.example.com");
    });

    it("conserva el puerto", () => {
      expect(
        resolveRedirectOrigin({
          originHeader: null,
          siteUrl: "http://localhost:3000",
        }),
      ).toBe("http://localhost:3000");
    });

    it("no se usa cuando el Origin es válido", () => {
      expect(
        resolveRedirectOrigin({
          originHeader: "https://pr-12-equipo.vercel.app",
          siteUrl: "http://localhost:3000",
        }),
      ).toBe("https://pr-12-equipo.vercel.app");
    });
  });
});
