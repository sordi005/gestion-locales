import { describe, expect, it } from "vitest";

import { stepsBackTo } from "../e2e/support/history";

// `stepsBackTo` decide cuántos pasos hay que retroceder en el historial del
// navegador para llegar a la entrada de una ruta (la pantalla protegida de antes
// de una salida con varias redirecciones). Es pura: el E2E le pasa las URL de
// `navigation.entries()` y la posición actual.

const ORIGIN = "http://localhost:3000";
const urls = (...paths: string[]) => paths.map((path) => `${ORIGIN}${path}`);

describe("stepsBackTo", () => {
  it("cuenta los pasos desde la entrada actual hasta la última entrada con esa ruta", () => {
    const entries = urls(
      "/login",
      "/locales",
      "/l/abc",
      "/auth/sin-acceso",
      "/login?aviso=sin-acceso",
    );

    expect(stepsBackTo(entries, 4, "/l/abc")).toBe(2);
  });

  it("ignora la query y el fragmento de la entrada", () => {
    const entries = urls("/l/abc?x=1#top", "/login");

    expect(stepsBackTo(entries, 1, "/l/abc")).toBe(1);
  });

  it("con la ruta repetida elige la más cercana hacia atrás, no la primera", () => {
    const entries = urls("/l/abc", "/locales", "/l/abc", "/login");

    expect(stepsBackTo(entries, 3, "/l/abc")).toBe(1);
  });

  it("no mira hacia adelante de la entrada actual", () => {
    const entries = urls(
      "/login",
      "/l/abc",
      "/login?aviso=sin-acceso",
      "/l/abc",
    );

    expect(stepsBackTo(entries, 2, "/l/abc")).toBe(1);
  });

  it("salta las entradas sin URL legible en lugar de fallar", () => {
    const entries = [`${ORIGIN}/l/abc`, "", `${ORIGIN}/login`];

    expect(stepsBackTo(entries, 2, "/l/abc")).toBe(2);
  });

  it("falla con un mensaje claro si la ruta no está en el historial", () => {
    expect(() => stepsBackTo(urls("/login", "/locales"), 1, "/l/abc")).toThrow(
      /\/l\/abc/,
    );
  });

  it("no cuenta la entrada actual aunque tenga esa ruta", () => {
    expect(() => stepsBackTo(urls("/login", "/l/abc"), 1, "/l/abc")).toThrow(
      /\/l\/abc/,
    );
  });
});
