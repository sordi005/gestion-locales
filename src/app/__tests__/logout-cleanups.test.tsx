import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LogoutCleanups } from "@/app/logout-cleanups";

// Spec auth-session "Cerrar sesión...": el punto único de registro de las tareas
// de limpieza vive en la capa `app` y se monta en todas las páginas. Vacío en
// C-05; lo llenan C-06, C-11 y C-19.

describe("LogoutCleanups", () => {
  it("no dibuja nada: solo existe para cargar el registro de tareas en toda página", () => {
    const { container } = render(<LogoutCleanups />);

    expect(container).toBeEmptyDOMElement();
  });
});
