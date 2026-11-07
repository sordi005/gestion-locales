import { describe, expect, it } from "vitest";

import type { BarcodeRejection } from "@/shared/lib/barcode";

import { scanAcceptedMessage, scanIssueMessage } from "../scan-messages";

describe("scanIssueMessage", () => {
  it.each<[BarcodeRejection, string]>([
    ["scientific_notation", "Parece un número de planilla, no un código."],
    ["decimal", "Tiene decimales, no es un código."],
    ["invalid_characters", "Tiene letras o símbolos."],
    ["too_long", "Tiene más de 14 números."],
    ["all_zeros", "Son todos ceros."],
    ["empty", "No se leyó nada."],
  ])("rejected %s", (reason, text) => {
    expect(
      scanIssueMessage({ kind: "rejected", reason, raw: "x", source: "hid" }),
    ).toBe(`Este código no es válido. ${text}`);
  });

  it.each<["camera" | "hid" | "manual"]>([["camera"], ["hid"]])(
    "retry desde %s",
    (source) => {
      expect(scanIssueMessage({ kind: "retry", raw: "x", source })).toBe(
        "No se leyó bien. Escaneá de nuevo.",
      );
    },
  );
});

describe("scanAcceptedMessage", () => {
  it.each<[string]>([["7790001000019"], ["36000291452"]])(
    "Leído: %s",
    (norm) => {
      expect(scanAcceptedMessage(norm)).toBe(`Leído: ${norm}`);
    },
  );
});
