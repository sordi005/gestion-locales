import { describe, expect, it } from "vitest";

import { decideResume } from "../resume-policy";
import type { CameraPermission, ResumeDecision } from "../resume-policy";

const MINUTE = 60_000;

describe("decideResume", () => {
  it.each<[boolean, number, CameraPermission, ResumeDecision]>([
    [true, 40_000, "granted", "auto"],
    [true, 0, "granted", "auto"],
    [true, 5 * MINUTE, "granted", "auto"],
    [true, 5 * MINUTE + 1, "granted", "tap"],
    [true, 6 * MINUTE, "granted", "tap"],
    [true, 40_000, "prompt", "tap"],
    [true, 40_000, "unknown", "tap"],
    [true, 40_000, "denied", "tap"],
    [false, 40_000, "granted", "none"],
    [false, 6 * MINUTE, "prompt", "none"],
  ])(
    "activa=%s, afuera %s ms, permiso %s → %s",
    (wasActive, hiddenMs, permission, expected) => {
      expect(decideResume({ wasActive, hiddenMs, permission })).toBe(expected);
    },
  );
});
