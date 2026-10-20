import type { Page } from "@playwright/test";

// Retroceso por el historial del navegador hasta la entrada de una ruta concreta.
// `page.goBack()` retrocede UNA entrada: cuando una salida pasa por varias
// redirecciones (cada una deja su entrada), esa entrada no es la pantalla protegida
// de antes. Acá se calcula con las URL de `navigation.entries()` (Chromium) y se
// retrocede de una sola vez con `history.go(-n)`.

/**
 * Cuántos pasos hay que retroceder desde la entrada `currentIndex` para llegar a la
 * entrada MÁS CERCANA hacia atrás cuya ruta (sin query ni fragmento) es `pathname`.
 * Pura. Lanza si no hay ninguna: es un error del test, no un resultado.
 */
export function stepsBackTo(
  entryUrls: readonly string[],
  currentIndex: number,
  pathname: string,
): number {
  for (let index = currentIndex - 1; index >= 0; index--) {
    const url = entryUrls[index];
    if (url && new URL(url).pathname === pathname) {
      return currentIndex - index;
    }
  }
  throw new Error(
    `No hay una entrada de ${pathname} antes de la actual en el historial: ${entryUrls.join(" → ")}.`,
  );
}

type NavigationLike = {
  entries(): { url: string | null }[];
  currentEntry: { index: number } | null;
};

/**
 * Vuelve, con un solo `history.go(-n)`, a la última entrada anterior cuya ruta es
 * `pathname`. No espera el resultado de la navegación: cada test debe esperar (con
 * `toHaveURL`) una URL que solo exista después del retroceso antes de afirmar lo demás.
 */
export async function goBackToEntry(
  page: Page,
  pathname: string,
): Promise<void> {
  const { urls, currentIndex } = await page.evaluate(() => {
    const navigation = (window as unknown as { navigation: NavigationLike })
      .navigation;
    return {
      urls: navigation.entries().map((entry) => entry.url ?? ""),
      currentIndex: navigation.currentEntry?.index ?? -1,
    };
  });
  const steps = stepsBackTo(urls, currentIndex, pathname);
  await page.evaluate((count) => history.go(-count), steps);
}
