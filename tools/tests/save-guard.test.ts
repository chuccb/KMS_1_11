import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existingSaveCommand } from "../serve-existing-save.ts";

test("recovery refuses absent/empty/directory saves without creating or rewriting files", () => {
  const dir = mkdtempSync(join(tmpdir(), "kms-save-guard-"));
  try {
    const missing = join(dir, "missing.json"),
      empty = join(dir, "empty.json"),
      save = join(dir, "progress.json");
    writeFileSync(empty, "");
    writeFileSync(save, '{"existing":true}');
    expect(() => existingSaveCommand(missing)).toThrow();
    expect(existsSync(missing)).toBe(false);
    expect(() => existingSaveCommand(empty)).toThrow();
    expect(() => existingSaveCommand(dir)).toThrow();
    const command = existingSaveCommand(save, { KMS_WEB_PORT: "9000" });
    expect(command[0]).toBe(process.execPath);
    expect(command.slice(-4)).toEqual(["--save", save, "--ping", "off"]);
    expect(command[command.indexOf("--web-port") + 1]).toBe("9000");
    expect(command).not.toContain("--account");
    expect(() => existingSaveCommand(save, { KMS_WEB_PORT: "0" })).toThrow();
    expect(readFileSync(save, "utf8")).toBe('{"existing":true}');
  } finally {
    rmSync(dir, { recursive: true });
  }
});
