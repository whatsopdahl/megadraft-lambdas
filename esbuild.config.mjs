import { build } from "esbuild";
import { readdirSync } from "node:fs";

const handlers = readdirSync("src/handlers").filter((f) => f.endsWith(".ts"));

await build({
  entryPoints: handlers.map((f) => `src/handlers/${f}`),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
  minify: true,
  external: ["@aws-sdk/*"],
});

console.log(`Built ${handlers.length} handlers into dist/`);
