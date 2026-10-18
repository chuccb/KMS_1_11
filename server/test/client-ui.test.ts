import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("browser canvas UI: title login, shop buy/sell, scroll, drag, inventory updates and tooltips", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/client_probe.mjs", import.meta.url))],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PORTAL COMMAND \/ CHAT FOCUS REGRESSIONS OK/);
  assert.match(result.stdout, /STAT\/AP REGRESSIONS OK/);
  assert.match(result.stdout, /SKILL BOOK \/ NATIVE ROW \/ EMPTY BEGINNER REGRESSION SOURCES OK/);
  assert.match(result.stdout, /SHOP REGRESSIONS OK/);
  assert.match(result.stdout, /TITLE REGRESSIONS OK/);
  assert.match(result.stdout, /RECOVERY \/ EXPLICIT TEST TOOL REGRESSION SOURCES OK/);
});
