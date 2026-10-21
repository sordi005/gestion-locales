import { describe, expect, it } from "vitest";

import { isWritable } from "../writable";

describe("isWritable", () => {
  it("una organización active se puede escribir", () => {
    expect(isWritable("active")).toBe(true);
  });

  it("una organización suspended queda en solo lectura (RN-TE-06)", () => {
    expect(isWritable("suspended")).toBe(false);
  });

  it.each(["", "ACTIVE", "Active ", "archived", "inactive", "disabled"])(
    "un estado desconocido (%j) no se puede escribir: falla cerrado",
    (status) => {
      expect(isWritable(status)).toBe(false);
    },
  );
});
