import type { Command } from "commander";
import { getPrimaryCommand } from "../argv.js";
import type { ProgramContext } from "./context.js";
import { registerBootstrapCommand } from "./register.bootstrap.js";
import { registerStartCommand } from "./register.start.js";
import { registerStopCommand } from "./register.stop.js";
import { registerUpdateCommand } from "./register.update.js";

type CommandRegisterParams = {
  program: Command;
  ctx: ProgramContext;
  argv: string[];
};

type CoreCliEntry = {
  name: string;
  description: string;
  register: (params: CommandRegisterParams) => Promise<void> | void;
};

const CORE_CLI_ENTRIES: CoreCliEntry[] = [
  {
    name: "bootstrap",
    description: "Bootstrap DenchClaw + OpenClaw and launch the web UI",
    register: ({ program }) => {
      registerBootstrapCommand(program);
    },
  },
  {
    name: "update",
    description: "Update Dench web runtime without onboarding",
    register: ({ program }) => {
      registerUpdateCommand(program);
    },
  },
  {
    name: "stop",
    description: "Stop Dench managed web runtime",
    register: ({ program }) => {
      registerStopCommand(program);
    },
  },
  {
    name: "start",
    description: "Start Dench managed web runtime",
    register: ({ program }) => {
      registerStartCommand(program);
    },
  },
];
const CORE_CLI_ENTRY_BY_NAME = new Map(CORE_CLI_ENTRIES.map((entry) => [entry.name, entry]));

export function getCoreCliCommandNames(): string[] {
  return CORE_CLI_ENTRIES.map((entry) => entry.name);
}

export function getCoreCliCommandsWithSubcommands(): string[] {
  return [];
}

export async function registerCoreCliByName(
  program: Command,
  ctx: ProgramContext,
  name: string,
  argv: string[] = process.argv,
): Promise<boolean> {
  const entry = CORE_CLI_ENTRY_BY_NAME.get(name);
  if (!entry) {
    return false;
  }
  await entry.register({ program, ctx, argv });
  return true;
}

export function registerCoreCliCommands(program: Command, ctx: ProgramContext, argv: string[]) {
  const primary = getPrimaryCommand(argv);
  if (primary) {
    const entry = CORE_CLI_ENTRY_BY_NAME.get(primary);
    if (!entry) {
      return;
    }
    void entry.register({ program, ctx, argv });
    return;
  }
  for (const entry of CORE_CLI_ENTRIES) {
    void entry.register({ program, ctx, argv });
  }
}

export function registerProgramCommands(
  program: Command,
  ctx: ProgramContext,
  argv: string[] = process.argv,
) {
  registerCoreCliCommands(program, ctx, argv);
}
