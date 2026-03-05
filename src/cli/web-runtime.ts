import { spawn, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { resolveLsofCommandSync } from "../infra/ports-lsof.js";
import { sleep } from "../utils.js";
import { listPortListeners, type PortProcess } from "./ports.js";

export const DEFAULT_WEB_APP_PORT = 3100;
const WEB_RUNTIME_DIRNAME = "web-runtime";
const WEB_RUNTIME_APP_DIRNAME = "app";
const WEB_RUNTIME_MANIFEST_FILENAME = "manifest.json";
const WEB_RUNTIME_PROCESS_FILENAME = "process.json";
const WEB_APP_PROBE_ATTEMPTS = 20;
const WEB_APP_PROBE_DELAY_MS = 750;
const WEB_APP_PROBE_TIMEOUT_MS = 1_500;
const LEGACY_STANDALONE_SEGMENT = "/apps/web/.next/standalone/apps/web";

export type WebProbeResult = {
  ok: boolean;
  status?: number;
  reason: string;
};

export type WebProfilesPayloadEvaluation = {
  ok: boolean;
  reason: string;
};

export type ManagedWebRuntimeManifest = {
  schemaVersion: 1;
  deployedDenchVersion: string;
  deployedAt: string;
  sourceStandaloneServer: string;
  lastPort?: number;
  lastGatewayPort?: number;
};

export type ManagedWebRuntimeProcess = {
  pid: number;
  port: number;
  gatewayPort: number;
  startedAt: string;
  runtimeAppDir: string;
};

export type InstallManagedWebRuntimeResult =
  | {
      installed: true;
      runtimeDir: string;
      runtimeAppDir: string;
      runtimeServerPath: string;
      manifest: ManagedWebRuntimeManifest;
    }
  | {
      installed: false;
      runtimeDir: string;
      runtimeAppDir: string;
      runtimeServerPath: string;
      reason: "standalone-missing";
    };

export type StartManagedWebRuntimeResult =
  | {
      started: true;
      pid: number;
      runtimeServerPath: string;
    }
  | {
      started: false;
      runtimeServerPath: string;
      reason: "runtime-missing";
    };

export type WebPortListenerOwnership = "managed" | "legacy-standalone" | "foreign";

export type WebPortListener = PortProcess & {
  cwd?: string;
  ownership: WebPortListenerOwnership;
};

export type StopManagedWebRuntimeResult = {
  port: number;
  stoppedPids: number[];
  skippedForeignPids: number[];
};

export type MajorVersionTransition = {
  previousMajor: number | null;
  currentMajor: number | null;
  isMajorTransition: boolean;
};

function normalizePathForMatch(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

function isPathWithin(parentDir: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseOptionalPositiveInt(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function ensureParentDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  ensureParentDir(filePath);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function resolveCommandForPlatform(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }
  if (path.extname(command)) {
    return command;
  }
  const normalized = path.basename(command).toLowerCase();
  if (
    normalized === "npm" ||
    normalized === "pnpm" ||
    normalized === "npx" ||
    normalized === "yarn"
  ) {
    return `${command}.cmd`;
  }
  return command;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    return err.code !== "ESRCH";
  }
}

async function terminatePidWithEscalation(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ESRCH") {
      return;
    }
    throw error;
  }

  for (let i = 0; i < 8; i += 1) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await sleep(100);
  }

  if (!isProcessAlive(pid)) {
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ESRCH") {
      return;
    }
    throw error;
  }

  for (let i = 0; i < 8; i += 1) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await sleep(100);
  }
}

export function resolveCliPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    if (existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function resolveProfileStateDir(
  profile: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  void profile;
  const home = resolveRequiredHomeDir(env, os.homedir);
  return path.join(home, ".openclaw-dench");
}

export function resolveManagedWebRuntimeDir(stateDir: string): string {
  return path.join(stateDir, WEB_RUNTIME_DIRNAME);
}

export function resolveManagedWebRuntimeAppDir(stateDir: string): string {
  return path.join(resolveManagedWebRuntimeDir(stateDir), WEB_RUNTIME_APP_DIRNAME);
}

export function resolveManagedWebRuntimeServerPath(stateDir: string): string {
  return path.join(resolveManagedWebRuntimeAppDir(stateDir), "server.js");
}

export function resolveManagedWebRuntimeManifestPath(stateDir: string): string {
  return path.join(resolveManagedWebRuntimeDir(stateDir), WEB_RUNTIME_MANIFEST_FILENAME);
}

export function resolveManagedWebRuntimeProcessPath(stateDir: string): string {
  return path.join(resolveManagedWebRuntimeDir(stateDir), WEB_RUNTIME_PROCESS_FILENAME);
}

export function resolvePackagedStandaloneServerPath(packageRoot: string): string {
  return path.join(packageRoot, "apps/web/.next/standalone/apps/web/server.js");
}

function resolvePackagedStandaloneAppDir(packageRoot: string): string {
  return path.dirname(resolvePackagedStandaloneServerPath(packageRoot));
}

export function readManagedWebRuntimeManifest(stateDir: string): ManagedWebRuntimeManifest | null {
  return readJsonFile<ManagedWebRuntimeManifest>(resolveManagedWebRuntimeManifestPath(stateDir));
}

export function readManagedWebRuntimeProcess(stateDir: string): ManagedWebRuntimeProcess | null {
  return readJsonFile<ManagedWebRuntimeProcess>(resolveManagedWebRuntimeProcessPath(stateDir));
}

function writeManagedWebRuntimeManifest(
  stateDir: string,
  manifest: ManagedWebRuntimeManifest,
): ManagedWebRuntimeManifest {
  writeJsonFile(resolveManagedWebRuntimeManifestPath(stateDir), manifest);
  return manifest;
}

function writeManagedWebRuntimeProcess(
  stateDir: string,
  processMeta: ManagedWebRuntimeProcess,
): void {
  writeJsonFile(resolveManagedWebRuntimeProcessPath(stateDir), processMeta);
}

function clearManagedWebRuntimeProcess(stateDir: string): void {
  rmSync(resolveManagedWebRuntimeProcessPath(stateDir), { force: true });
}

function updateManifestLastPort(
  stateDir: string,
  webPort: number,
  gatewayPort: number,
): ManagedWebRuntimeManifest | null {
  const manifest = readManagedWebRuntimeManifest(stateDir);
  if (!manifest) {
    return null;
  }
  const nextManifest: ManagedWebRuntimeManifest = {
    ...manifest,
    lastPort: webPort,
    lastGatewayPort: gatewayPort,
  };
  return writeManagedWebRuntimeManifest(stateDir, nextManifest);
}

export function evaluateWebProfilesPayload(payload: unknown): WebProfilesPayloadEvaluation {
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "response payload is not an object" };
  }

  const data = payload as Record<string, unknown>;
  const profiles = Array.isArray(data.profiles)
    ? data.profiles
    : Array.isArray(data.workspaces)
      ? data.workspaces
      : undefined;
  if (!profiles) {
    return { ok: false, reason: "response payload missing profiles/workspaces array" };
  }

  const active =
    data.activeProfile === null || typeof data.activeProfile === "string"
      ? data.activeProfile
      : data.activeWorkspace === null || typeof data.activeWorkspace === "string"
        ? data.activeWorkspace
        : undefined;

  if (active === undefined) {
    return { ok: false, reason: "response payload missing active profile/workspace field" };
  }

  return { ok: true, reason: "profiles payload shape is valid" };
}

export async function probeWebRuntime(port: number): Promise<WebProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_APP_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/profiles`, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });
    if (response.status < 200 || response.status >= 400) {
      return {
        ok: false,
        status: response.status,
        reason: `/api/profiles returned status ${response.status}`,
      };
    }
    const payload = await response.json().catch(() => null);
    const evaluation = evaluateWebProfilesPayload(payload);
    return {
      ok: evaluation.ok,
      status: response.status,
      reason: evaluation.reason,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: message || "probe failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForWebRuntime(port: number): Promise<WebProbeResult> {
  let lastResult: WebProbeResult = { ok: false, reason: "web runtime did not respond" };
  for (let attempt = 0; attempt < WEB_APP_PROBE_ATTEMPTS; attempt += 1) {
    const result = await probeWebRuntime(port);
    if (result.ok) {
      return result;
    }
    lastResult = result;
    await sleep(WEB_APP_PROBE_DELAY_MS);
  }
  return lastResult;
}

export function classifyWebPortListener(params: {
  cwd: string | undefined;
  managedRuntimeAppDir: string;
}): WebPortListenerOwnership {
  if (!params.cwd) {
    return "foreign";
  }
  if (isPathWithin(params.managedRuntimeAppDir, params.cwd)) {
    return "managed";
  }
  const cwdNormalized = normalizePathForMatch(params.cwd);
  if (cwdNormalized.includes(LEGACY_STANDALONE_SEGMENT)) {
    return "legacy-standalone";
  }
  return "foreign";
}

export function parseSemverMajor(version: string | undefined): number | null {
  if (!version) {
    return null;
  }
  const match = version.trim().match(/^v?(\d+)(?:\.\d+)?(?:\.\d+)?(?:[-+].*)?$/u);
  if (!match) {
    return null;
  }
  const major = Number.parseInt(match[1], 10);
  if (!Number.isFinite(major)) {
    return null;
  }
  return major;
}

export function evaluateMajorVersionTransition(params: {
  previousVersion: string | undefined;
  currentVersion: string | undefined;
}): MajorVersionTransition {
  const previousMajor = parseSemverMajor(params.previousVersion);
  const currentMajor = parseSemverMajor(params.currentVersion);
  return {
    previousMajor,
    currentMajor,
    isMajorTransition:
      previousMajor !== null && currentMajor !== null && previousMajor !== currentMajor,
  };
}

function resolveProcessCwd(pid: number): string | undefined {
  try {
    const lsof = resolveLsofCommandSync();
    const output = execFileSync(lsof, ["-nP", "-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf-8",
    });
    for (const line of output.split(/\r?\n/)) {
      if (line.startsWith("n")) {
        const cwd = line.slice(1).trim();
        if (cwd.length > 0) {
          return cwd;
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function inspectWebPortListeners(port: number, stateDir: string): WebPortListener[] {
  if (process.env.VITEST === "true" && process.env.OPENCLAW_TEST_REAL_PORTS !== "1") {
    return [];
  }
  const listeners = listPortListeners(port);
  const managedRuntimeAppDir = resolveManagedWebRuntimeAppDir(stateDir);
  return listeners.map((listener) => {
    const cwd = resolveProcessCwd(listener.pid);
    const ownership = classifyWebPortListener({
      cwd,
      managedRuntimeAppDir,
    });
    return {
      ...listener,
      cwd,
      ownership,
    };
  });
}

export function readLastKnownWebPort(stateDir: string): number {
  const processMeta = readManagedWebRuntimeProcess(stateDir);
  const processPort = parseOptionalPositiveInt(processMeta?.port);
  if (processPort) {
    return processPort;
  }
  const manifest = readManagedWebRuntimeManifest(stateDir);
  const manifestPort = parseOptionalPositiveInt(manifest?.lastPort);
  if (manifestPort) {
    return manifestPort;
  }
  return DEFAULT_WEB_APP_PORT;
}

export function installManagedWebRuntime(params: {
  stateDir: string;
  packageRoot: string;
  denchVersion: string;
  webPort?: number;
  gatewayPort?: number;
}): InstallManagedWebRuntimeResult {
  const runtimeDir = resolveManagedWebRuntimeDir(params.stateDir);
  const runtimeAppDir = resolveManagedWebRuntimeAppDir(params.stateDir);
  const runtimeServerPath = resolveManagedWebRuntimeServerPath(params.stateDir);
  const sourceStandaloneServer = resolvePackagedStandaloneServerPath(params.packageRoot);
  const sourceAppDir = resolvePackagedStandaloneAppDir(params.packageRoot);
  if (!existsSync(sourceStandaloneServer)) {
    return {
      installed: false,
      runtimeDir,
      runtimeAppDir,
      runtimeServerPath,
      reason: "standalone-missing",
    };
  }

  mkdirSync(runtimeDir, { recursive: true });
  rmSync(runtimeAppDir, { recursive: true, force: true });
  cpSync(sourceAppDir, runtimeAppDir, { recursive: true, force: true });

  const manifest: ManagedWebRuntimeManifest = {
    schemaVersion: 1,
    deployedDenchVersion: params.denchVersion,
    deployedAt: new Date().toISOString(),
    sourceStandaloneServer,
    ...(typeof params.webPort === "number" ? { lastPort: params.webPort } : {}),
    ...(typeof params.gatewayPort === "number" ? { lastGatewayPort: params.gatewayPort } : {}),
  };
  writeManagedWebRuntimeManifest(params.stateDir, manifest);

  return {
    installed: true,
    runtimeDir,
    runtimeAppDir,
    runtimeServerPath,
    manifest,
  };
}

export async function stopManagedWebRuntime(params: {
  stateDir: string;
  port: number;
  includeLegacyStandalone?: boolean;
}): Promise<StopManagedWebRuntimeResult> {
  const listeners = inspectWebPortListeners(params.port, params.stateDir);
  const includeLegacyStandalone = params.includeLegacyStandalone ?? true;
  const stoppable = listeners.filter(
    (listener) =>
      listener.ownership === "managed" ||
      (includeLegacyStandalone && listener.ownership === "legacy-standalone"),
  );
  const skippedForeign = listeners.filter((listener) => listener.ownership === "foreign");

  const uniquePids = [...new Set(stoppable.map((listener) => listener.pid))];
  const stoppedPids: number[] = [];
  for (const pid of uniquePids) {
    await terminatePidWithEscalation(pid);
    if (!isProcessAlive(pid)) {
      stoppedPids.push(pid);
    }
  }

  const processMeta = readManagedWebRuntimeProcess(params.stateDir);
  if (processMeta?.port === params.port && stoppedPids.includes(processMeta.pid)) {
    clearManagedWebRuntimeProcess(params.stateDir);
  }

  const remainingManaged = inspectWebPortListeners(params.port, params.stateDir).filter(
    (listener) => listener.ownership === "managed",
  );
  if (remainingManaged.length === 0) {
    clearManagedWebRuntimeProcess(params.stateDir);
  }

  return {
    port: params.port,
    stoppedPids,
    skippedForeignPids: [...new Set(skippedForeign.map((listener) => listener.pid))],
  };
}

export function startManagedWebRuntime(params: {
  stateDir: string;
  port: number;
  gatewayPort: number;
  env?: NodeJS.ProcessEnv;
}): StartManagedWebRuntimeResult {
  const runtimeServerPath = resolveManagedWebRuntimeServerPath(params.stateDir);
  if (!existsSync(runtimeServerPath)) {
    return { started: false, runtimeServerPath, reason: "runtime-missing" };
  }

  const logsDir = path.join(params.stateDir, "logs");
  mkdirSync(logsDir, { recursive: true });
  const outFd = openSync(path.join(logsDir, "web-app.log"), "a");
  const errFd = openSync(path.join(logsDir, "web-app.err.log"), "a");

  const child = spawn(process.execPath, [runtimeServerPath], {
    cwd: path.dirname(runtimeServerPath),
    detached: true,
    stdio: ["ignore", outFd, errFd],
    env: {
      ...process.env,
      ...params.env,
      PORT: String(params.port),
      HOSTNAME: "127.0.0.1",
      OPENCLAW_GATEWAY_PORT: String(params.gatewayPort),
    },
  });
  child.unref();

  writeManagedWebRuntimeProcess(params.stateDir, {
    pid: child.pid ?? -1,
    port: params.port,
    gatewayPort: params.gatewayPort,
    startedAt: new Date().toISOString(),
    runtimeAppDir: path.dirname(runtimeServerPath),
  });
  updateManifestLastPort(params.stateDir, params.port, params.gatewayPort);

  return {
    started: true,
    pid: child.pid ?? -1,
    runtimeServerPath,
  };
}

export async function ensureManagedWebRuntime(params: {
  stateDir: string;
  packageRoot: string;
  denchVersion: string;
  port: number;
  gatewayPort: number;
}): Promise<{ ready: boolean; reason: string }> {
  const install = installManagedWebRuntime({
    stateDir: params.stateDir,
    packageRoot: params.packageRoot,
    denchVersion: params.denchVersion,
    webPort: params.port,
    gatewayPort: params.gatewayPort,
  });
  if (!install.installed) {
    return { ready: false, reason: "standalone web build is missing from package" };
  }

  await stopManagedWebRuntime({
    stateDir: params.stateDir,
    port: params.port,
    includeLegacyStandalone: true,
  });

  const listenersAfterStop = inspectWebPortListeners(params.port, params.stateDir);
  const foreign = listenersAfterStop.filter((listener) => listener.ownership === "foreign");
  if (foreign.length > 0) {
    const detail = foreign
      .map((listener) => `${listener.pid}${listener.command ? `:${listener.command}` : ""}`)
      .join(", ");
    return {
      ready: false,
      reason: `port ${params.port} is owned by non-Dench process(es): ${detail}`,
    };
  }

  const start = startManagedWebRuntime({
    stateDir: params.stateDir,
    port: params.port,
    gatewayPort: params.gatewayPort,
  });
  if (!start.started) {
    return {
      ready: false,
      reason: "managed web runtime is missing after install",
    };
  }

  const probe = await waitForWebRuntime(params.port);
  return {
    ready: probe.ok,
    reason: probe.reason,
  };
}

export function resolveOpenClawCommandOrThrow(): string {
  try {
    const locator = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(locator, ["openclaw"], { encoding: "utf-8" }).trim();
    const first = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (first) {
      return first;
    }
    throw new Error("openclaw command not found");
  } catch {
    throw new Error(
      "Global `openclaw` CLI was not found on PATH. Install it with: npm install -g openclaw",
    );
  }
}

export async function runOpenClawCommand(params: {
  openclawCommand: string;
  args: string[];
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(resolveCommandForPlatform(params.openclawCommand), params.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: params.env ? { ...process.env, ...params.env } : process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      child.kill("SIGKILL");
    }, params.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}
