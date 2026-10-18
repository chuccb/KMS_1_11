import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("browser movement/audio/selection/scene: fixed-step physics, climbing, playback races and stable culling", () => {
  const result = spawnSync(
    process.execPath,
    [
      "test",
      "--timeout",
      "30000",
      fileURLToPath(new URL("./presentation-equipment.test.ts", import.meta.url)),
      fileURLToPath(new URL("./presentation-display.test.ts", import.meta.url)),
      fileURLToPath(new URL("./presentation-minimap.test.ts", import.meta.url)),
      fileURLToPath(new URL("./presentation-portal.test.ts", import.meta.url)),
      fileURLToPath(new URL("./presentation-motion.test.ts", import.meta.url)),
      fileURLToPath(new URL("./presentation-temporarystats.test.ts", import.meta.url)),
      fileURLToPath(new URL("./presentation-audio.test.ts", import.meta.url)),
      fileURLToPath(new URL("./presentation-selection.test.ts", import.meta.url)),
      fileURLToPath(new URL("./presentation-scene.test.ts", import.meta.url)),
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    },
  );
  assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout + result.stderr, /0 fail/);
});
