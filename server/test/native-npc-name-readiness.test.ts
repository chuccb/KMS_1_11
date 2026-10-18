/** ADR-075 SOURCE ONLY. Not run/typechecked/browser/probed. */
import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Browser module intentionally has no declaration.
import { chatBalloons } from "../../client/chatballoons.mjs";
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
  const balloons = chatBalloons({ image: () => ({ ready }) });
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
