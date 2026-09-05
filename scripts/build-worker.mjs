import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();

await build({
  entryPoints: [path.join(root, "worker/import-worker.ts")],
  outfile: path.join(root, "dist/import-worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
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
