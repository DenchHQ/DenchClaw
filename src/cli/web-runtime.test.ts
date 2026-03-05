import { describe, expect, it } from "vitest";
import {
  classifyWebPortListener,
  evaluateMajorVersionTransition,
  evaluateWebProfilesPayload,
} from "./web-runtime.js";

describe("evaluateWebProfilesPayload", () => {
  it("accepts nullable active profile when profiles payload shape is valid (prevents first-run false negatives)", () => {
    const result = evaluateWebProfilesPayload({
      profiles: [],
      activeProfile: null,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts workspace compatibility fields when profile aliases are missing (preserves API compatibility)", () => {
    const result = evaluateWebProfilesPayload({
      workspaces: [{ name: "default" }],
      activeWorkspace: "default",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects payloads that omit active profile/workspace state (guards readiness contract)", () => {
    const result = evaluateWebProfilesPayload({
      profiles: [],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("active profile/workspace");
  });
});

describe("classifyWebPortListener", () => {
  it("classifies listeners under managed runtime dir as managed ownership (prevents cross-process kills)", () => {
    const managedRuntimeAppDir = "/Users/test/.openclaw-dench/web-runtime/app";
    const ownership = classifyWebPortListener({
      cwd: "/Users/test/.openclaw-dench/web-runtime/app",
      managedRuntimeAppDir,
    });
    expect(ownership).toBe("managed");
  });

  it("classifies legacy standalone cwd as dench-owned legacy runtime (supports old bootstrap cleanup)", () => {
    const ownership = classifyWebPortListener({
      cwd: "/Users/test/projects/ironclaw/apps/web/.next/standalone/apps/web",
      managedRuntimeAppDir: "/Users/test/.openclaw-dench/web-runtime/app",
    });
    expect(ownership).toBe("legacy-standalone");
  });

  it("classifies unknown cwd as foreign ownership (enforces process boundary safety)", () => {
    const ownership = classifyWebPortListener({
      cwd: "/Applications/OtherApp/runtime",
      managedRuntimeAppDir: "/Users/test/.openclaw-dench/web-runtime/app",
    });
    expect(ownership).toBe("foreign");
  });
});

describe("evaluateMajorVersionTransition", () => {
  it("detects major changes across semver values (enforces mandatory upgrade gate)", () => {
    const result = evaluateMajorVersionTransition({
      previousVersion: "2.9.0",
      currentVersion: "3.0.1",
    });
    expect(result.isMajorTransition).toBe(true);
    expect(result.previousMajor).toBe(2);
    expect(result.currentMajor).toBe(3);
  });

  it("treats prerelease-to-minor within same major as non-major transition (avoids unnecessary blocking)", () => {
    const result = evaluateMajorVersionTransition({
      previousVersion: "2.0.0-1",
      currentVersion: "2.1.0",
    });
    expect(result.isMajorTransition).toBe(false);
    expect(result.previousMajor).toBe(2);
    expect(result.currentMajor).toBe(2);
  });
});
