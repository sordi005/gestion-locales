import { expect } from "@playwright/test";
import { z } from "zod";

// Lector de Mailpit (el correo local de `supabase start`, CLI 2.119): busca por
// destinatario con `/api/v1/search` y trae cada cuerpo con `/api/v1/message/{id}`.

export type MailpitMessage = {
  id: string;
  subject: string;
  to: string[];
  html: string;
  text: string;
};

type MailpitResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};
export type MailpitFetch = (url: string) => Promise<MailpitResponse>;

export type MailpitOptions = {
  /** Por defecto, `MAILPIT_URL` del entorno. */
  mailpitUrl?: string;
  /** Por defecto, el `fetch` de Node (se cambia en los tests unitarios). */
  fetchFn?: MailpitFetch;
};

export type WaitForEmailOptions = MailpitOptions & {
  /** Solo emails cuyo asunto coincide (texto contenido o expresión regular). */
  subject?: string | RegExp;
  /** Tope total de espera. */
  timeout?: number;
  /** Pausas entre consultas; la última se repite. */
  intervals?: number[];
};

const addressSchema = z.object({ Address: z.string() });
const searchSchema = z.object({
  messages: z.array(
    z.object({ ID: z.string(), To: z.array(addressSchema).nullish() }),
  ),
});
const messageSchema = z.object({
  ID: z.string(),
  Subject: z.string(),
  To: z.array(addressSchema).nullish(),
  HTML: z.string(),
  Text: z.string(),
});

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_INTERVALS_MS = [250, 500, 1_000];

function resolveMailpitUrl(options: MailpitOptions): string {
  const url = options.mailpitUrl ?? process.env.MAILPIT_URL;
  if (url === undefined || url.trim() === "") {
    throw new Error(
      "Falta MAILPIT_URL para leer el correo local (armá .env.local con scripts/ci/local-supabase-env.ts).",
    );
  }
  return url.trim().replace(/\/+$/, "");
}

async function getJson(fetchFn: MailpitFetch, url: string): Promise<unknown> {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Mailpit respondió HTTP ${response.status} en ${url}.`);
  }
  return response.json();
}

function addressesOf(entries: { Address: string }[] | null | undefined) {
  return (entries ?? []).map((entry) => entry.Address);
}

/**
 * Todos los emails dirigidos exactamente a `to` (el más nuevo primero). La
 * búsqueda de Mailpit calza por texto contenido, así que se vuelve a filtrar por
 * dirección exacta: un test nunca debe ver el email de otro usuario.
 */
export async function findEmails(
  to: string,
  options: MailpitOptions = {},
): Promise<MailpitMessage[]> {
  const base = resolveMailpitUrl(options);
  const fetchFn: MailpitFetch = options.fetchFn ?? ((url) => fetch(url));
  const wanted = to.toLowerCase();

  const searchUrl = new URL("/api/v1/search", base);
  searchUrl.searchParams.set("query", `to:"${to}"`);
  const found = searchSchema.parse(
    await getJson(fetchFn, searchUrl.toString()),
  );

  const exact = found.messages.filter((message) =>
    addressesOf(message.To).some((address) => address.toLowerCase() === wanted),
  );

  return Promise.all(
    exact.map(async ({ ID }) => {
      const message = messageSchema.parse(
        await getJson(
          fetchFn,
          `${base}/api/v1/message/${encodeURIComponent(ID)}`,
        ),
      );
      return {
        id: message.ID,
        subject: message.Subject,
        to: addressesOf(message.To),
        html: message.HTML,
        text: message.Text,
      };
    }),
  );
}

function subjectMatches(
  subject: string,
  wanted: string | RegExp | undefined,
): boolean {
  if (wanted === undefined) return true;
  return typeof wanted === "string"
    ? subject.includes(wanted)
    : wanted.test(subject);
}

/**
 * Espera por sondeo (`expect.poll`) a que llegue un email para `to`, con un tope
 * de tiempo, y devuelve el más nuevo que cumple el filtro de asunto.
 */
export async function waitForEmail(
  to: string,
  options: WaitForEmailOptions = {},
): Promise<MailpitMessage> {
  const { subject, timeout = DEFAULT_TIMEOUT_MS } = options;
  const intervals = options.intervals ?? DEFAULT_INTERVALS_MS;
  const result: { message?: MailpitMessage } = {};

  await expect
    .poll(
      async () => {
        const messages = await findEmails(to, options);
        result.message = messages.find((candidate) =>
          subjectMatches(candidate.subject, subject),
        );
        return result.message !== undefined;
      },
      {
        timeout,
        intervals,
        message: `No llegó ningún email para ${to}${
          subject === undefined ? "" : ` con el asunto ${String(subject)}`
        } en ${timeout} ms.`,
      },
    )
    .toBe(true);

  if (result.message === undefined) {
    throw new Error(`No llegó ningún email para ${to}.`);
  }
  return result.message;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
};

/** El `href` del primer enlace (el botón) del cuerpo HTML, con las entidades decodificadas. */
export function extractLink(message: Pick<MailpitMessage, "html">): string {
  const match = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(
    message.html,
  );
  const href = match?.[1] ?? match?.[2];
  if (href === undefined) {
    throw new Error("El email no tiene ningún enlace.");
  }
  return href.replace(
    /&(?:amp|lt|gt|quot|#39|#x27);/g,
    (entity) => HTML_ENTITIES[entity] ?? entity,
  );
}
