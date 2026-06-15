import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const plugins = [
  "extensions/dench-identity/index.ts",
  "extensions/dench-ai-gateway/index.ts",
  "extensions/apollo-enrichment/index.ts",
];

for (const entry of plugins) {
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: path.join(root, entry.replace(/\.ts$/, ".mjs")),
    packages: "external",
  });
}
