import { describe, it, expect } from "vitest";
import {
  rewriteBareArgvToBootstrap,
  shouldEnableBootstrapCutover,
  shouldEnsureCliPath,
  shouldDelegateToGlobalOpenClaw,
} from "./run-main.js";

describe("run-main bootstrap cutover", () => {
  it("rewrites bare ironclaw invocations to bootstrap by default", () => {
    const argv = ["node", "ironclaw"];
    expect(rewriteBareArgvToBootstrap(argv, {})).toEqual(["node", "ironclaw", "bootstrap"]);
  });

  it("does not rewrite when a command already exists", () => {
    const argv = ["node", "ironclaw", "chat"];
    expect(rewriteBareArgvToBootstrap(argv, {})).toEqual(argv);
  });

  it("does not rewrite non-ironclaw CLIs", () => {
    const argv = ["node", "openclaw"];
    expect(rewriteBareArgvToBootstrap(argv, {})).toEqual(argv);
  });

  it("disables cutover in legacy rollout stage", () => {
    const env = { IRONCLAW_BOOTSTRAP_ROLLOUT: "legacy" };
    expect(shouldEnableBootstrapCutover(env)).toBe(false);
    expect(rewriteBareArgvToBootstrap(["node", "ironclaw"], env)).toEqual(["node", "ironclaw"]);
  });

  it("requires opt-in for beta rollout stage", () => {
    const envNoOptIn = { IRONCLAW_BOOTSTRAP_ROLLOUT: "beta" };
    const envOptIn = {
      IRONCLAW_BOOTSTRAP_ROLLOUT: "beta",
      IRONCLAW_BOOTSTRAP_BETA_OPT_IN: "1",
    };

    expect(shouldEnableBootstrapCutover(envNoOptIn)).toBe(false);
    expect(shouldEnableBootstrapCutover(envOptIn)).toBe(true);
  });

  it("honors explicit legacy fallback override", () => {
    const env = { IRONCLAW_BOOTSTRAP_LEGACY_FALLBACK: "1" };
    expect(shouldEnableBootstrapCutover(env)).toBe(false);
    expect(rewriteBareArgvToBootstrap(["node", "ironclaw"], env)).toEqual(["node", "ironclaw"]);
  });
});

describe("run-main delegation and path guards", () => {
  it("skips CLI path bootstrap for read-only status/help commands", () => {
    expect(shouldEnsureCliPath(["node", "ironclaw", "--help"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "ironclaw", "status"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "ironclaw", "health"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "ironclaw", "sessions"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "ironclaw", "config", "get"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "ironclaw", "models", "list"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "ironclaw", "chat", "send"])).toBe(true);
  });

  it("delegates non-bootstrap commands by default and never delegates bootstrap", () => {
    expect(shouldDelegateToGlobalOpenClaw(["node", "ironclaw", "chat"])).toBe(true);
    expect(shouldDelegateToGlobalOpenClaw(["node", "ironclaw", "bootstrap"])).toBe(false);
    expect(shouldDelegateToGlobalOpenClaw(["node", "ironclaw"])).toBe(false);
  });

  it("disables delegation when explicit env disable flag is set", () => {
    expect(
      shouldDelegateToGlobalOpenClaw(["node", "ironclaw", "chat"], {
        IRONCLAW_DISABLE_OPENCLAW_DELEGATION: "1",
      }),
    ).toBe(false);
    expect(
      shouldDelegateToGlobalOpenClaw(["node", "ironclaw", "chat"], {
        OPENCLAW_DISABLE_OPENCLAW_DELEGATION: "true",
      }),
    ).toBe(false);
  });
});
