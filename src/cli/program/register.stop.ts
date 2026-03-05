import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { stopWebRuntimeCommand } from "../web-runtime-command.js";

export function registerStopCommand(program: Command) {
  program
    .command("stop")
    .description("Stop Dench managed web runtime on the configured port")
    .option("--profile <name>", "Compatibility flag; non-dench values are ignored with a warning")
    .option("--web-port <port>", "Web runtime port override")
    .option("--json", "Output summary as JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await stopWebRuntimeCommand({
          profile: opts.profile as string | undefined,
          webPort: opts.webPort as string | undefined,
          json: Boolean(opts.json),
        });
      });
    });
}
