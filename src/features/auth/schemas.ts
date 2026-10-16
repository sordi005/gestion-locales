import { z } from "zod";

// Esquemas de toda entrada del flujo de auth (regla 3: Zod antes de tocar la
// base). Los mensajes son los que ve la persona, en castellano.

const MIN_PASSWORD_CHARACTERS = 8;
// bcrypt ignora lo que pasa de 72 bytes: se rechaza en lugar de truncar en silencio.
const MAX_PASSWORD_BYTES = 72;

const emailField = z
  .string({ error: "Escribí tu email." })
  .trim()
  .min(1, "Escribí tu email.")
  .pipe(z.email("Escribí un email válido."));

/** Ingreso: el mínimo de 8 NO se exige acá, para no dejar afuera contraseñas viejas. */
export const loginSchema = z.object({
  email: emailField,
  password: z
    .string({ error: "Escribí tu contraseña." })
    .min(1, "Escribí tu contraseña."),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const passwordResetRequestSchema = z.object({ email: emailField });

export type PasswordResetRequestInput = z.infer<
  typeof passwordResetRequestSchema
>;

const INVALID_LINK = "El link no es válido.";

/** Los tipos de link que ofrece la app; Supabase tiene más (`signup`, `magiclink`…). */
export const LINK_TYPES = ["invite", "recovery"] as const;

export type LinkType = (typeof LINK_TYPES)[number];

/** Parámetros de `/auth/confirm`. */
export const linkParamsSchema = z.object({
  token_hash: z
    .string({ error: INVALID_LINK })
    .max(256, INVALID_LINK)
    // El `+` también rechaza el texto vacío.
    .regex(/^[A-Za-z0-9_-]+$/, INVALID_LINK),
  type: z.enum(LINK_TYPES, { error: INVALID_LINK }),
});

export type LinkParams = z.infer<typeof linkParamsSchema>;

/** Código del flujo PKCE que trae `/auth/callback` (GoTrue emite un UUID). */
export const callbackCodeSchema = z
  .string({ error: INVALID_LINK })
  .max(256, INVALID_LINK)
  // El `+` también rechaza el texto vacío.
  .regex(/^[A-Za-z0-9_-]+$/, INVALID_LINK);

/**
 * Política de contraseña nueva: al menos 8 caracteres (cuenta caracteres, no
 * unidades UTF-16) y a lo sumo 72 bytes en UTF-8. Sin reglas de símbolos,
 * números ni mayúsculas, y sin recortar espacios.
 */
export const passwordPolicySchema = z
  .string({ error: "Escribí una contraseña." })
  .refine(
    (value) => Array.from(value).length >= MIN_PASSWORD_CHARACTERS,
    `La contraseña tiene que tener al menos ${MIN_PASSWORD_CHARACTERS} caracteres.`,
  )
  .refine(
    (value) => new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES,
    "La contraseña es demasiado larga.",
  );

/** Formulario de `/actualizar-contrasena`. */
export const newPasswordSchema = z
  .object({
    password: passwordPolicySchema,
    confirmPassword: z.string({ error: "Repetí la contraseña." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });

export type NewPasswordInput = z.infer<typeof newPasswordSchema>;
