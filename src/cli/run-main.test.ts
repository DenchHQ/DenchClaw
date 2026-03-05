import { describe, it, expect } from "vitest";
import {
  rewriteBareArgvToBootstrap,
  shouldHideCliBanner,
  shouldEnableBootstrapCutover,
  shouldEnsureCliPath,
  shouldDelegateToGlobalOpenClaw,
} from "./run-main.js";

describe("run-main bootstrap cutover", () => {
  it("rewrites bare denchclaw invocations to bootstrap by default", () => {
    const argv = ["node", "denchclaw"];
    expect(rewriteBareArgvToBootstrap(argv, {})).toEqual(["node", "denchclaw", "bootstrap"]);
  });

  it("does not rewrite when a command already exists", () => {
    const argv = ["node", "denchclaw", "chat"];
    expect(rewriteBareArgvToBootstrap(argv, {})).toEqual(argv);
  });

  it("does not rewrite non-denchclaw CLIs", () => {
    const argv = ["node", "openclaw"];
    expect(rewriteBareArgvToBootstrap(argv, {})).toEqual(argv);
  });

  it("disables cutover in legacy rollout stage", () => {
    const env = { DENCHCLAW_BOOTSTRAP_ROLLOUT: "legacy" };
    expect(shouldEnableBootstrapCutover(env)).toBe(false);
    expect(rewriteBareArgvToBootstrap(["node", "denchclaw"], env)).toEqual(["node", "denchclaw"]);
  });

  it("requires opt-in for beta rollout stage", () => {
    const envNoOptIn = { DENCHCLAW_BOOTSTRAP_ROLLOUT: "beta" };
    const envOptIn = {
      DENCHCLAW_BOOTSTRAP_ROLLOUT: "beta",
      DENCHCLAW_BOOTSTRAP_BETA_OPT_IN: "1",
    };

    expect(shouldEnableBootstrapCutover(envNoOptIn)).toBe(false);
    expect(shouldEnableBootstrapCutover(envOptIn)).toBe(true);
  });

  it("honors explicit legacy fallback override", () => {
    const env = { DENCHCLAW_BOOTSTRAP_LEGACY_FALLBACK: "1" };
    expect(shouldEnableBootstrapCutover(env)).toBe(false);
    expect(rewriteBareArgvToBootstrap(["node", "denchclaw"], env)).toEqual(["node", "denchclaw"]);
  });
});

describe("run-main delegation and path guards", () => {
  it("skips CLI path bootstrap for read-only status/help commands", () => {
    expect(shouldEnsureCliPath(["node", "denchclaw", "--help"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "denchclaw", "status"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "denchclaw", "health"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "denchclaw", "sessions"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "denchclaw", "config", "get"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "denchclaw", "models", "list"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "denchclaw", "chat", "send"])).toBe(true);
  });

  it("delegates non-bootstrap commands by default and never delegates bootstrap", () => {
    expect(shouldDelegateToGlobalOpenClaw(["node", "denchclaw", "chat"])).toBe(true);
    expect(shouldDelegateToGlobalOpenClaw(["node", "denchclaw", "bootstrap"])).toBe(false);
    expect(shouldDelegateToGlobalOpenClaw(["node", "denchclaw", "update"])).toBe(false);
    expect(shouldDelegateToGlobalOpenClaw(["node", "denchclaw", "stop"])).toBe(false);
    expect(shouldDelegateToGlobalOpenClaw(["node", "denchclaw", "start"])).toBe(false);
    expect(shouldDelegateToGlobalOpenClaw(["node", "denchclaw"])).toBe(false);
  });

  it("disables delegation when explicit env disable flag is set", () => {
    expect(
      shouldDelegateToGlobalOpenClaw(["node", "denchclaw", "chat"], {
        DENCHCLAW_DISABLE_OPENCLAW_DELEGATION: "1",
      }),
    ).toBe(false);
    expect(
      shouldDelegateToGlobalOpenClaw(["node", "denchclaw", "chat"], {
        OPENCLAW_DISABLE_OPENCLAW_DELEGATION: "true",
      }),
    ).toBe(false);
  });
});

describe("run-main banner visibility", () => {
  it("keeps banner visible for update/start/stop lifecycle commands", () => {
    expect(shouldHideCliBanner(["node", "denchclaw", "update"])).toBe(false);
    expect(shouldHideCliBanner(["node", "denchclaw", "start"])).toBe(false);
    expect(shouldHideCliBanner(["node", "denchclaw", "stop"])).toBe(false);
  });

  it("hides banner only for completion and plugin-update helper commands", () => {
    expect(shouldHideCliBanner(["node", "denchclaw", "completion"])).toBe(true);
    expect(shouldHideCliBanner(["node", "denchclaw", "plugins", "update"])).toBe(true);
    expect(shouldHideCliBanner(["node", "denchclaw", "chat"])).toBe(false);
  });
});
