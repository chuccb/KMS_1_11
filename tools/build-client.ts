/** Build browser assets only. Never load a save, log in, or connect to a live game. */
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outdir = resolve(root, "dist/client");
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const build = await Bun.build({
  entrypoints: [resolve(root, "client/main.js")],
  outdir,
  target: "browser",
  format: "esm",
  sourcemap: "external",
  minify: false,
});
if (!build.success) throw new AggregateError(build.logs, "Browser build failed");
for (const name of ["index.html", "style.css", "fonts"]) {
  const source = resolve(root, "client", name);
  if ((await Bun.file(source).exists()) || name === "fonts") {
    await cp(source, resolve(outdir, name), { recursive: true });
  }
}
console.log(`Browser assets built in ${outdir}`);
