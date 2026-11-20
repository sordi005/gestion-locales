import type { Page } from "@playwright/test";

// Un lector USB en modo teclado, con la temporización que ve la página de uno real.
//
// Por qué no `page.keyboard.type(code, { delay })`: Playwright manda cada tecla y espera a
// que la página la procese antes de mandar la siguiente, y el navegador le pone a cada
// `KeyboardEvent` el instante en que la recibe. Con la hoja abierta (un input controlado de
// React en `next dev` que se vuelve a renderizar en cada tecla) el promedio entre teclas ya
// queda en 20–27 ms con la máquina tranquila, contra los 30 ms del contrato del detector
// (C-10), y con la máquina cargada lo pasa: la ráfaga se toma como tipeo humano y el test
// falla de forma intermitente. Un lector real no depende de eso: el `timeStamp` de sus teclas
// sale de la entrada del sistema, no de lo ocupada que esté la página.
//
// Por eso cada tecla se manda por CDP (`Input.dispatchKeyEvent`) con su propio `timestamp`,
// a `READER_GAP_MS` de la anterior: el detector mide exactamente la ráfaga de un lector y
// la tecla igual pasa por el camino de entrada real del navegador (keydown con su texto,
// keypress, input y keyup), así que el comportamiento por defecto (escribir el dígito, el
// Enter que envía un formulario) es el mismo que con un teclado. Solo Chromium (los dos
// proyectos con navegador lo son).

/** Intervalo entre teclas de un lector USB típico (ms): muy por debajo de los 30 ms del contrato. */
const READER_GAP_MS = 5;

type KeyDefinition = {
  readonly key: string;
  readonly code: string;
  readonly windowsVirtualKeyCode: number;
  readonly text: string;
};

const ENTER: KeyDefinition = {
  key: "Enter",
  code: "Enter",
  windowsVirtualKeyCode: 13,
  text: "\r",
};

function digitKey(digit: string): KeyDefinition {
  return {
    key: digit,
    code: `Digit${digit}`,
    windowsVirtualKeyCode: digit.charCodeAt(0),
    text: digit,
  };
}

/**
 * Manda `code` (solo dígitos) y el `Enter` final como lo haría un lector USB: una tecla
 * cada `READER_GAP_MS` según el reloj de los eventos, sin importar cuánto tarde la página
 * en procesar cada una. Va al elemento que tenga el foco.
 */
export async function readerBurst(page: Page, code: string): Promise<void> {
  if (!/^[0-9]+$/.test(code)) {
    throw new Error(`readerBurst solo manda dígitos: recibió "${code}"`);
  }
  const keys = [...code].map(digitKey).concat(ENTER);
  const cdp = await page.context().newCDPSession(page);
  try {
    // `timestamp` va en segundos desde la época (`TimeSinceEpoch` de CDP).
    const start = Date.now() / 1000;
    for (const [index, key] of keys.entries()) {
      const timestamp = start + (index * READER_GAP_MS) / 1000;
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: key.key,
        code: key.code,
        windowsVirtualKeyCode: key.windowsVirtualKeyCode,
        text: key.text,
        unmodifiedText: key.text,
        timestamp,
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: key.key,
        code: key.code,
        windowsVirtualKeyCode: key.windowsVirtualKeyCode,
        timestamp,
      });
    }
  } finally {
    await cdp.detach();
  }
}
