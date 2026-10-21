import { z } from "zod";

// Los ids que llegan por la URL (`/l/[locationId]`, `/org/[orgId]`) son entrada
// externa: se validan antes de buscarlos (regla dura 3). Un id mal formado se
// trata igual que uno inexistente (404 uniforme, D2). `z.uuid()` acepta los ids
// del seed (UUID v4) y los UUID v7 del cliente. Se normaliza a minúsculas (Postgres
// devuelve los uuid así): quien escribe su propio local en mayúsculas lo encuentra.

const uuidParam = z.uuid().transform((id) => id.toLowerCase());

/** Id de un local tal como llega de la URL. */
export const locationIdSchema = uuidParam;

/** Id de una organización tal como llega de la URL. */
export const orgIdSchema = uuidParam;
