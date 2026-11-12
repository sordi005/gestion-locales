import Link from "next/link";
import type { ReactNode } from "react";

import { requireUser } from "@/features/auth/server";
import { PRODUCT_NAME } from "@/shared/lib/brand";

/**
 * Fuentes de datos (C-64, DD-34): la atribución que piden las licencias de las dos
 * fuentes de la base de productos compartida. Texto verificado y aprobado por el
 * fundador el 2026-11-05 (PQ-27). Es una página protegida (el proxy manda a
 * `/login` a quien no ingresó) y llama a la guarda por su cuenta.
 */

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      {...EXTERNAL}
      className="underline underline-offset-4 hover:text-foreground"
    >
      {children}
    </a>
  );
}

export default async function DataSourcesPage() {
  await requireUser();

  return (
    <main
      id="contenido"
      className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 md:p-6"
    >
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-sm underline-offset-4 hover:underline">
          Volver al inicio
        </Link>
        <h1 className="text-xl font-semibold">Fuentes de datos</h1>
        <p className="text-muted-foreground">
          {PRODUCT_NAME} sugiere el nombre, la marca y la presentación de un
          producto cuando escaneás su código. Esa información sale de datos
          abiertos y de lo que cargan los comercios. Acá están las fuentes y sus
          licencias.
        </p>
      </div>

      <section
        aria-labelledby="fuente-sepa"
        className="flex flex-col gap-3 rounded-lg border p-4"
      >
        <h2 id="fuente-sepa" className="text-lg font-semibold">
          SEPA / Precios Claros
        </h2>
        <p>
          Datos de Precios Claros (SEPA - Sistema Electrónico de Publicidad de
          Precios Argentinos), publicados por la Secretaría de Comercio de la
          Nación en el portal de datos abiertos del Estado argentino.
        </p>
        <p>
          Licencia:{" "}
          <External href="https://creativecommons.org/licenses/by/4.0/deed.es">
            CC BY 4.0
          </External>{" "}
          en la página del dataset, y{" "}
          <External href="https://creativecommons.org/licenses/by/2.5/ar/">
            CC BY 2.5 AR
          </External>{" "}
          en los términos de Precios Claros. Se permite el uso, también
          comercial, citando la fuente.
        </p>
        <p>
          <External href="https://datos.gob.ar/dataset/precios-claros-base-sepa">
            Página del dataset (datos.gob.ar)
          </External>
        </p>
      </section>

      <section
        aria-labelledby="fuente-off"
        className="flex flex-col gap-3 rounded-lg border p-4"
      >
        <h2 id="fuente-off" className="text-lg font-semibold">
          Open Food Facts
        </h2>
        <p>
          Datos de{" "}
          <External href="https://world.openfoodfacts.org">
            Open Food Facts
          </External>
          , la base de productos alimenticios que arma una comunidad de
          colaboradores. La usamos de respaldo para los códigos que el SEPA no
          trae.
        </p>
        <p>
          Licencia: la base de datos está bajo{" "}
          <External href="https://opendatacommons.org/licenses/odbl/1-0/">
            ODbL 1.0
          </External>{" "}
          y sus contenidos bajo{" "}
          <External href="https://opendatacommons.org/licenses/dbcl/1-0/">
            DbCL
          </External>
          . Los datos que cargamos de esta fuente se publican con esta licencia;
          si el equipo corrige una a mano, deja de contar como dato de Open Food
          Facts.
        </p>
      </section>

      <section aria-labelledby="que-usamos" className="flex flex-col gap-2">
        <h2 id="que-usamos" className="text-lg font-semibold">
          Qué usamos y qué no
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            De cada producto usamos solo el código de barras, el nombre, la
            marca y la presentación.
          </li>
          <li>No usamos precios: ni de las fuentes ni de ningún comercio.</li>
          <li>
            No usamos las imágenes de Open Food Facts: tienen otra licencia.
          </li>
          <li>
            Los códigos que cargan los comercios solo entran a la base si dos o
            más comercios los nombran igual o si los aprueba el equipo, y nunca
            se informa qué comercio cargó cada uno.
          </li>
        </ul>
      </section>
    </main>
  );
}
