import { expect, test as setup } from "@playwright/test";

import { signInThroughUi } from "./support/auth-ui";
import { readSeedPassword } from "./support/seed";
import {
  STORAGE_STATE_USERS,
  seedEmailFor,
  storageStateFor,
} from "./support/storage-state";

// Proyecto `setup` (D15): ingresa por la UI con cada usuario del seed que usan los
// E2E y guarda su sesión en `playwright/.auth/<usuario>.json`. Corre una vez al
// empezar la corrida; `desktop-keyboard` y `mobile` dependen de él. Los usuarios del
// seed solo ingresan y leen: las sesiones guardadas son de solo lectura (ver
// `support/storage-state.ts`).

for (const user of STORAGE_STATE_USERS) {
  setup(`ingresa ${user} y guarda su sesión`, async ({ page }) => {
    await signInThroughUi(page, {
      email: seedEmailFor(user),
      password: readSeedPassword(),
    });

    // Cada persona termina en su inicio (local, selector o pantalla del super-admin):
    // lo único que importa acá es que dejó de estar en `/login` con la sesión puesta.
    await expect(page).not.toHaveURL(/\/login/);

    await page.context().storageState({ path: storageStateFor(user) });
  });
}
