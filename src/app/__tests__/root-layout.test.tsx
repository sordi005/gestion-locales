import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import RootLayout from "@/app/layout";

// Spec app-shell "Contenido principal y salto en cada marco": el layout raíz
// conserva "Saltar al contenido" pero NO envuelve todo en un <main>: cada marco
// dibuja el suyo (`<main id="contenido">`), así la navegación del marco queda
// fuera del contenido principal. Se simula solo la carga de la fuente.

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-sans-test" }),
  Geist_Mono: () => ({ variable: "font-mono-test" }),
}));

function renderLayout(children: React.ReactNode = <p>contenido de prueba</p>) {
  // `RootLayout` pide `LayoutProps<"/">` (tipo generado por Next): solo usa `children`.
  const props = { children } as Parameters<typeof RootLayout>[0];
  return renderToStaticMarkup(<RootLayout {...props} />);
}

describe("layout raíz", () => {
  it("no dibuja ningún <main>: lo dibuja cada marco", () => {
    const html = renderLayout();

    expect(html).not.toMatch(/<main[\s>]/);
  });

  it('conserva el enlace "Saltar al contenido" hacia #contenido, antes del contenido', () => {
    const html = renderLayout();

    const skipLink = html.match(/<a [^>]*href="#contenido"[^>]*>([^<]*)<\/a>/);
    expect(skipLink?.[1]).toBe("Saltar al contenido");
    expect(html.indexOf("Saltar al contenido")).toBeLessThan(
      html.indexOf("contenido de prueba"),
    );
  });

  it("deja pasar el contenido tal cual, con el idioma en castellano", () => {
    const html = renderLayout(<section id="x">hola</section>);

    expect(html).toContain('<section id="x">hola</section>');
    expect(html).toMatch(/<html[^>]* lang="es"/);
  });
});
