import { describe, expect, it } from "vitest";

import { cn } from "@/shared/lib/utils";

describe("cn", () => {
  it("resuelve conflictos de clases de Tailwind: gana la última", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("ignora valores falsy y conserva el resto en orden", () => {
    expect(cn("text-sm", false, undefined, "font-bold")).toBe(
      "text-sm font-bold",
    );
  });

  it("soporta clases condicionales con objetos y arrays", () => {
    expect(cn(["flex", { hidden: false, "items-center": true }])).toBe(
      "flex items-center",
    );
  });
});
