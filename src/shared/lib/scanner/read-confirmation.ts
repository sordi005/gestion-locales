// Confirmación de lecturas de la cámara. Módulo puro: el estado vive en la
// clausura y no hay reloj.
//
// Una lectura suelta de la cámara puede estar mal aunque su dígito verificador
// sea válido (el EAN-13 solo atrapa ~90% de las lecturas al azar: una etiqueta
// curva impresa 7790490998309 llegó a leerse 4790080998309). Por eso la cámara
// acepta un código recién cuando lo lee igual en `CONFIRM_READS` cuadros, sin
// otro código en el medio. Solo rige para la cámara: el tipeo y el lector HID
// entregan el código completo, sin adivinar.
//
// Cómo se suelta lo confirmado (decisión): NO se suelta por tiempo ni por
// cuadros sin verlo; lo reemplaza otro código leído `required` veces seguidas.
// De la ausencia real (retirar el producto y volver a ponerlo) se ocupa el
// filtro de repeticiones, con su ventana de tiempo: soltar acá además alargaría
// la ausencia que ve el filtro y recontaría un producto quieto con un parpadeo.
// Una lectura suelta distinta con el producto a la vista es solo un cuadro
// perdido, nunca un producto nuevo.

/** Cuadros iguales, sin otro código en el medio, para aceptar una lectura de la cámara. */
export const CONFIRM_READS = 3;

export type ReadConfirmation = {
  /**
   * Un cuadro: el código visto (`null` si no se vio ninguno). Devuelve la
   * clave que hay que pasarle al filtro de repeticiones: el código confirmado
   * mientras siga a la vista, o `null` (cuadro perdido) si todavía no se
   * confirmó o este cuadro no lo vio.
   */
  observe(key: string | null): string | null;
  /** Olvida al candidato y al confirmado (apagar la cámara). */
  reset(): void;
};

export function createReadConfirmation(options: {
  readonly required: number;
}): ReadConfirmation {
  const { required } = options;
  let confirmed: string | null = null;
  let candidate: { key: string; count: number } | null = null;

  return {
    observe(key) {
      if (key === null) {
        // Un cuadro vacío no corta ni suma a la racha del candidato.
        return null;
      }
      if (key === confirmed) {
        // Ver al confirmado es "otro código en el medio" para el candidato.
        candidate = null;
        return key;
      }

      candidate =
        candidate?.key === key
          ? { key, count: candidate.count + 1 }
          : { key, count: 1 };
      if (candidate.count < required) return null;

      confirmed = key;
      candidate = null;
      return key;
    },
    reset() {
      confirmed = null;
      candidate = null;
    },
  };
}
