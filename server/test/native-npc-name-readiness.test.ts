/** ADR-169 NPC nameplate visibility and front-plane balloon regressions. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chatBalloons } from "../../client/chatballoons.ts";
import { balloonLayout, balloonTop } from "../../client/chatlayout.ts";

test("NPC nameplate is drawn while self-talk is active, independent of balloon readiness", () => {
  const source = readFileSync(new URL("../../client/main.js", import.meta.url), "utf8");
  const npcBranch = source.match(
    /if\s*\(actor\.kind\s*===\s*"npc"\)\s*\{([\s\S]*?)\}\s*else if\s*\(actor\.kind\s*===\s*"mob"\)/,
  )?.[1];
  assert.ok(npcBranch, "NPC actor render branch exists");
  assert.match(
    npcBranch,
    /drawName\(npcMetadata\.get\(actor\.npc\.templateId\)\?\.name,\s*x,\s*y,\s*"#ffff20"\);/,
    "the NPC branch draws its nameplate",
  );
  assert.doesNotMatch(
    npcBranch,
    /npcVisuals\.speaking|npcBalloons\.visible/,
    "speech state and balloon draw readiness must not suppress the nameplate",
  );
});

test("front-plane NPC balloon geometry stays above the feet-anchored nameplate", () => {
  const renderSource = readFileSync(new URL("../../client/main.js", import.meta.url), "utf8");
  const balloonSource = readFileSync(
    new URL("../../client/chatballoons.ts", import.meta.url),
    "utf8",
  );
  assert.match(renderSource, /kind:'npc-speech',npc,id,z:250210/);
  assert.match(balloonSource, /top\s*=\s*balloonTop\(y,\s*originY,\s*at\)/);
  const npcY = 275;
  const nameplateTop = npcY + 2;
  for (const text of ["Hi", "a fairly long NPC speech balloon that wraps over several lines."]) {
    const layout = balloonLayout(text, (value) => value.length * 6);
    assert.equal(
      layout.y,
      -layout.height,
      "balloon top is one full layout height above its anchor",
    );
    assert.equal(
      layout.arrowY + 13,
      layout.height,
      "normal WZ arrow closes the layout's bottom edge",
    );
    for (const originY of [0, 1, 33, 72]) {
      const top = balloonTop(npcY, originY, layout);
      const balloonBottom = top + layout.height;
      assert.ok(
        balloonBottom < nameplateTop,
        `speech art bottom ${balloonBottom} must remain above nameplate top ${nameplateTop}`,
      );
    }
  }
});

test("NPC balloon visibility requires drawable art and a canvas anchor", (t) => {
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
  assert.equal(balloons.visible(1, 60, 100), false, "cold frame does not draw the speech balloon");
  ready = true;
  assert.equal(balloons.visible(1, 60, 100), true);
  assert.equal(
    balloons.visible(1, undefined, 100),
    false,
    "missing canvas0 anchor prevents balloon draw",
  );
  assert.equal(balloons.visible(1, 60, 5100), false, "the speech balloon expires after 5000ms");
  balloons.remove(1);
  assert.equal(balloons.visible(1, 60, 200), false);
});
