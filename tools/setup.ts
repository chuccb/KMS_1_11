/** Install locked development dependencies with Bun only; no project tests or game execution. */
import manifest from "../package.json";
const expected = manifest.packageManager.split("@")[1];
if (Bun.version !== expected)
  throw new Error(
    `Bun ${expected} required; found ${Bun.version}. Install the pinned stable version first.`,
  );
const child = Bun.spawn([process.execPath, "install", "--frozen-lockfile", "--ignore-scripts"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exitCode = await child.exited;
