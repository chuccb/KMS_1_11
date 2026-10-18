/** Refuse missing/empty saves before the CLI can create a replacement world. */
import { statSync } from "node:fs";
import { resolve } from "node:path";

export function existingSaveCommand(
  save: string,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const path = resolve(save);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size === 0)
    throw new Error(
      "Save must be an existing, nonempty regular file; nothing was created or restored.",
    );
  const port = (key: string, fallback: number) => {
    const raw = env[key];
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${key}`);
    return String(value);
  };
  const root = resolve(import.meta.dirname, "..");
  return [
    process.execPath,
    resolve(root, "server/src/cli.ts"),
    "serve",
    "--host",
    "0.0.0.0",
    "--port",
    port("KMS_LOGIN_PORT", 8516),
    "--game-port",
    port("KMS_GAME_PORT", 8517),
    "--web-port",
    port("KMS_WEB_PORT", 8515),
    "--data",
    resolve(root, "Data.wz"),
    "--save",
    path,
    "--ping",
    "off",
  ];
}

if (import.meta.main) {
  if (Bun.argv.length !== 3)
    throw new Error(
      "Usage: bun tools/serve-existing-save.ts <existing-save.json>. Stop the old server and cold-back up first.",
    );
  const child = Bun.spawn(existingSaveCommand(Bun.argv[2]), {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  process.exitCode = await child.exited;
}
