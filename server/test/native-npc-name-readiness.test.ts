/** ADR-075 Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";

import { chatBalloons } from "../../client/chatballoons.ts";
test("native name suppression waits for a drawable NPC balloon, not merely a pending metadata timer", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { fonts: { addEventListener() {} } },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  });
  let ready = false;
  const balloons = chatBalloons({ image: () => ({ ready, img: {} as CanvasImageSource }) });
  balloons.put(1, "npc speech", 100, { preserveWhitespace: true });
  assert.equal(
    balloons.visible(1, 60, 100),
    false,
    "cold original frame cannot hide both name AND balloon",
  );
  ready = true;
  assert.equal(balloons.visible(1, 60, 100), true);
  assert.equal(
    balloons.visible(1, undefined, 100),
    false,
    "missing canvas0 anchor is not a drawn balloon",
  );
  assert.equal(balloons.visible(1, 60, 5100), false, "5000ms expiration restores the name");
  balloons.remove(1);
  assert.equal(balloons.visible(1, 60, 200), false);
});
