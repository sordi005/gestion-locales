import { describe, expect, it } from "vitest";

import { barcodeKey } from "@/shared/lib/barcode";
import type { BarcodeRejection } from "@/shared/lib/barcode";

import { EMPTY_SCAN_MEMORY, toScanOutcome } from "../scan-result";
import type { ScanMemory, ScanSource } from "../scan-result";

const VALID = "7790001000019";
const BAD_DIGIT = "7790001000018";

describe("toScanOutcome: lectura válida", () => {
  it("entrega un Scan normalizado desde la cámara", () => {
    const { outcome } = toScanOutcome(
      VALID,
      "camera",
      null,
      EMPTY_SCAN_MEMORY,
      0,
    );
    expect(outcome.kind).toBe("scan");
    if (outcome.kind !== "scan") return;
    expect(outcome.scan).toEqual({
      norm: VALID,
      key: barcodeKey(outcome.scan.norm),
      raw: VALID,
      source: "camera",
      multiplier: null,
      warnings: [],
    });
  });

  it.each<[string, ScanSource, number | null, string]>([
    [VALID, "hid", 3, "7790001000019"],
    ["036000291452", "camera", null, "36000291452"],
    [" 7790001000019 \n", "manual", 12, "7790001000019"],
  ])(
    "raw %j desde %s con multiplicador %s → key %s",
    (raw, source, multiplier, key) => {
      const { outcome } = toScanOutcome(
        raw,
        source,
        multiplier,
        EMPTY_SCAN_MEMORY,
        0,
      );
      expect(outcome.kind).toBe("scan");
      if (outcome.kind !== "scan") return;
      expect(outcome.scan.key).toBe(key);
      expect(outcome.scan.raw).toBe(raw);
      expect(outcome.scan.source).toBe(source);
      expect(outcome.scan.multiplier).toBe(multiplier);
      expect(outcome.scan.warnings).toEqual([]);
    },
  );

  it("un código interno de 10 dígitos pasa sin advertencias", () => {
    const { outcome } = toScanOutcome(
      "1234567890",
      "camera",
      null,
      EMPTY_SCAN_MEMORY,
      0,
    );
    expect(outcome.kind).toBe("scan");
    if (outcome.kind !== "scan") return;
    expect(outcome.scan.warnings).toEqual([]);
  });
});

describe("toScanOutcome: rechazos", () => {
  it.each<[string, BarcodeRejection]>([
    ["", "empty"],
    ["   ", "empty"],
    ["7.79E+12", "scientific_notation"],
    ["12.5", "decimal"],
    ["ABC-123", "invalid_characters"],
    ["123456789012345", "too_long"],
    ["0000000000000", "all_zeros"],
  ])("%j → rejected con motivo %s", (raw, reason) => {
    const { outcome } = toScanOutcome(raw, "hid", null, EMPTY_SCAN_MEMORY, 0);
    expect(outcome).toEqual({ kind: "rejected", reason, raw, source: "hid" });
  });
});

describe("toScanOutcome: dígito verificador inválido", () => {
  it.each<ScanSource>(["camera", "hid"])(
    "la primera lectura desde %s pide re-escanear",
    (source) => {
      const { outcome } = toScanOutcome(
        BAD_DIGIT,
        source,
        null,
        EMPTY_SCAN_MEMORY,
        0,
      );
      expect(outcome).toEqual({ kind: "retry", raw: BAD_DIGIT, source });
    },
  );

  it("tipeado a mano se acepta con la advertencia al primer intento", () => {
    const { outcome } = toScanOutcome(
      BAD_DIGIT,
      "manual",
      null,
      EMPTY_SCAN_MEMORY,
      0,
    );
    expect(outcome.kind).toBe("scan");
    if (outcome.kind !== "scan") return;
    expect(outcome.scan.warnings).toEqual(["invalid_check_digit"]);
    expect(outcome.scan.source).toBe("manual");
  });

  describe("memoria del último inválido", () => {
    function read(
      raw: string,
      memory: ScanMemory,
      now: number,
      source: ScanSource = "hid",
    ) {
      return toScanOutcome(raw, source, null, memory, now);
    }

    it.each<[number]>([[3_000], [9_999]])(
      "el mismo inválido a %s ms se acepta con advertencia",
      (gap) => {
        const first = read(BAD_DIGIT, EMPTY_SCAN_MEMORY, 1_000);
        expect(first.outcome.kind).toBe("retry");
        const second = read(BAD_DIGIT, first.memory, 1_000 + gap);
        expect(second.outcome.kind).toBe("scan");
        if (second.outcome.kind !== "scan") return;
        expect(second.outcome.scan.warnings).toEqual(["invalid_check_digit"]);
      },
    );

    it.each<[number]>([[10_000], [11_000]])(
      "a %s ms ya no cuenta: vuelve a pedir re-escanear",
      (gap) => {
        const first = read(BAD_DIGIT, EMPTY_SCAN_MEMORY, 1_000);
        const second = read(BAD_DIGIT, first.memory, 1_000 + gap);
        expect(second.outcome.kind).toBe("retry");
      },
    );

    it("el mismo inválido por UPC-A y EAN-13 con cero cuenta como el mismo", () => {
      const first = read("036000291453", EMPTY_SCAN_MEMORY, 0);
      const second = read("0036000291453", first.memory, 1_000);
      expect(first.outcome.kind).toBe("retry");
      expect(second.outcome.kind).toBe("scan");
    });

    it.each<[string, string]>([
      ["otro inválido", "7790001000025"],
      ["un código válido", VALID],
      ["un rechazo", "ABC"],
    ])("%s en el medio corta la cuenta", (_label, other) => {
      const first = read(BAD_DIGIT, EMPTY_SCAN_MEMORY, 0);
      const between = read(other, first.memory, 1_000);
      const again = read(BAD_DIGIT, between.memory, 2_000);
      expect(again.outcome.kind).toBe("retry");
    });

    it("tras aceptar por repetición, un tercer igual dentro de la ventana también se acepta", () => {
      const first = read(BAD_DIGIT, EMPTY_SCAN_MEMORY, 0);
      const second = read(BAD_DIGIT, first.memory, 3_000);
      const third = read(BAD_DIGIT, second.memory, 6_000);
      expect(third.outcome.kind).toBe("scan");
    });

    it("una lectura manual en el medio corta la cuenta", () => {
      const first = read(BAD_DIGIT, EMPTY_SCAN_MEMORY, 0);
      const manual = read(VALID, first.memory, 1_000, "manual");
      const again = read(BAD_DIGIT, manual.memory, 2_000);
      expect(again.outcome.kind).toBe("retry");
    });
  });
});
