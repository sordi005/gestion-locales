import { test as base } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createAdminClient,
  createIsolatedUser,
  deleteUser,
  isolatedEmail,
  inviteUser,
  type IsolatedUser,
} from "./supabase-admin";

/** El nombre con el que la fixture `invitedUser` invita (`data.full_name`). */
export const INVITED_FULL_NAME = "Invitada E2E";

export type InvitedUser = { id: string; email: string; fullName: string };

type TestFixtures = {
  /** Un usuario `e2e-<aleatorio>@e2e.test` creado para este test y borrado al terminar. */
  isolatedUser: IsolatedUser;
  /**
   * Un `e2e-<aleatorio>@e2e.test` invitado como lo hará C-07 (secret key, `data.full_name`
   * y `redirectTo` al `baseURL`): sin contraseña ni email confirmado, con su email de
   * invitación ya en Mailpit. Se borra al terminar.
   */
  invitedUser: InvitedUser;
};

type WorkerFixtures = {
  /** Cliente admin (secret key) para preparar y verificar datos. */
  admin: SupabaseClient;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  admin: [
    async ({}, provide) => {
      await provide(createAdminClient());
    },
    { scope: "worker" },
  ],

  isolatedUser: async ({ admin }, provide) => {
    const user = await createIsolatedUser(admin);
    // Lo que sigue a `provide` corre aunque el test falle: el usuario siempre se borra.
    await provide(user);
    await deleteUser(admin, user.id);
  },

  invitedUser: async ({ admin, baseURL }, provide) => {
    const email = isolatedEmail();
    const { id } = await inviteUser(admin, {
      email,
      fullName: INVITED_FULL_NAME,
      redirectTo: `${baseURL ?? "http://localhost:3000"}/auth/callback`,
    });
    // Como en `isolatedUser`: lo que sigue a `provide` corre aunque el test falle.
    await provide({ id, email, fullName: INVITED_FULL_NAME });
    await deleteUser(admin, id);
  },
});

export { expect } from "@playwright/test";
