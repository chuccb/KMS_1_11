import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("browser movement/audio/selection/scene: fixed-step physics, climbing, playback races and stable culling", () => {
  const result = spawnSync(process.execPath, ["--test", fileURLToPath(new URL("../scripts/equipment_probe.mjs", import.meta.url)), fileURLToPath(new URL("../scripts/display_probe.mjs", import.meta.url)), fileURLToPath(new URL("../scripts/minimap_probe.mjs", import.meta.url)), fileURLToPath(new URL("../scripts/portal_probe.mjs", import.meta.url)), fileURLToPath(new URL("../scripts/motion_probe.mjs", import.meta.url)), fileURLToPath(new URL("../scripts/temporarystats_probe.mjs", import.meta.url)), fileURLToPath(new URL("../scripts/audio_probe.mjs", import.meta.url)), fileURLToPath(new URL("../scripts/selection_probe.mjs", import.meta.url)), fileURLToPath(new URL("../scripts/scene_probe.mjs", import.meta.url))], {
    encoding: "utf8", timeout: 30_000, env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });
  assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /# fail 0/);
});
