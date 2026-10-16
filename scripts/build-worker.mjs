import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const root = process.cwd();

await build({
  entryPoints: [path.join(root, "worker/import-worker.ts")],
  outfile: path.join(root, "dist/import-worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  sourcemap: true,
  plugins: [{
    name: "workspace-aliases",
    setup(context) {
      context.onResolve({ filter: /^@\// }, (args) => context.resolve(`./${args.path.slice(2)}`, { resolveDir: root, kind: args.kind }));
      context.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
      context.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "export {};", loader: "js" }));
    },
  }],
});

// Load the finished bundle without a database or a scheduled import. This also
// catches CommonJS dependencies that cannot start inside an ESM bundle.
const startup = spawnSync(process.execPath, [path.join(root, "dist/import-worker.mjs")], {
  env: { ...process.env, IMPORT_SYNC_TIME: "invalid" },
  encoding: "utf8",
  timeout: 10_000,
});
if (startup.error || startup.status !== 1 || !startup.stderr.includes("IMPORT_SYNC_TIME muss HH:MM enthalten.")) {
  throw new Error("Der gebaute Import-Worker konnte nicht geladen werden.", { cause: startup.error || startup.stderr });
}
