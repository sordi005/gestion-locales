import Link from "next/link";

const TEXT = {
  title: "No encontramos esta página",
  description:
    "La dirección no existe o ya no está disponible. Revisá que esté bien escrita o volvé al inicio.",
  home: "Volver al inicio",
} as const;

/**
 * Pantalla de "página inexistente" de toda la app, en castellano (regla dura 4:
 * sin este archivo Next muestra su 404 en inglés). Pensada para el teclado de la
 * PC del mostrador: el único elemento interactivo es el enlace al inicio. No crea
 * otro `<main>`: el landmark es el del layout raíz.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{TEXT.title}</h1>
      <p className="max-w-sm text-lg text-muted-foreground">
        {TEXT.description}
      </p>
      <Link
        href="/"
        className="rounded-md px-3 py-2 text-base underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {TEXT.home}
      </Link>
    </div>
  );
}
