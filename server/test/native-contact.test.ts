/** Regression SOURCES ONLY: not executed, typechecked or browser-validated for this delivery. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mobRect,
  mobContactRect,
  playerContactRect,
  intersects,
  contactImpulse,
  mergeImpulse,
  contactClock,
} from "../../client/contact.ts";
import { rollNativeTouch } from "../src/game/nativecombat.ts";
import { ClientRandom } from "../src/protocol/random.ts";
import { encodeClientInteract, INTERACT_KIND_REVIVE } from "../src/protocol/field.ts";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf } from "../src/game/wzart.ts";
import { mobArtOf } from "../src/game/sprites.ts";
import { loadMobTemplate } from "../src/game/mobs.ts";
import { composeAvatar } from "../src/game/avatar.ts";
import type { StatBasis } from "../../client/characterstats.ts";
const basic: StatBasis["basic"] = {
  level: 10,
  job: 0,
  str: 4,
  dex: 4,
  int: 4,
  luk: 4,
  maxHp: 50,
  maxMp: 30,
};

test("touch uses conditional stream-2 draws, including equality MISS and zero PA's minimum hit", () => {
  let draws = 0;
  const random = () => {
    draws++;
    return 0;
  };
  assert.equal(rollNativeTouch(basic, { eva: 0 }, { level: 1, acc: 0, pa: 100 }, random), 0);
  assert.equal(draws, 1, "MISS does not draw physical damage");
  draws = 0;
  assert.equal(rollNativeTouch(basic, { eva: 0 }, { level: 1, acc: 1, pa: 0 }, random), 1);
  assert.equal(draws, 2, "PA=0 still draws, then clamps to one");
  draws = 0;
  assert.equal(
    rollNativeTouch(basic, { eva: 3 }, { level: 15, acc: 2, pa: 0 }, () => {
      draws++;
      return 9999999;
    }),
    1,
  );
  assert.equal(draws, 2, "level gap is C integer division: 3 - trunc(5/2) = 1");
  assert.equal(
    rollNativeTouch(basic, { eva: 3 }, { level: 10, acc: 2, pa: 100 }, () => 9999999),
    0,
  );
  assert.equal(
    rollNativeTouch(basic, { eva: -50 }, { level: 1, acc: 1, pa: 0 }, () => 0),
    1,
  );
});

test("4C8ED0 job-specific defence coefficients; beginner does not get the warrior formula", () => {
  for (const [job, expected] of [
    [0, 70],
    [100, 66],
    [200, 51],
    [300, 65],
    [400, 65],
  ]) {
    assert.equal(
      rollNativeTouch(
        { ...basic, job: job! },
        { eva: 0, pdd: 100 },
        { level: 10, acc: 1, pa: 100 },
        () => 0,
      ),
      expected,
    );
  }
  const attack = new ClientRandom(1, 2, 3),
    touch = new ClientRandom(1, 2, 3);
  const before = [...attack.state];
  rollNativeTouch(basic, { eva: 0 }, { level: 1, acc: 1, pa: 100 }, () => touch.next());
  assert.deepEqual(attack.state, before, "touch cannot advance the ordinary attack stream");
  assert.notDeepEqual(touch.state, before);
});

test("native current-frame RECT, mirror, swept union, inner-body shrink and strict edge intersection", () => {
  const f = { bounds: { left: -18, top: -26, right: 19, bottom: 0 } };
  assert.deepEqual(mobRect(f, { x: 0, y: 0 }, true), {
    left: -19,
    top: -26,
    right: 18,
    bottom: 0,
  });
  assert.deepEqual(mobContactRect(f, { x: 0, y: 0 }), {
    left: -1,
    top: -14,
    right: 1,
    bottom: -10,
  });
  assert.deepEqual(playerContactRect({ x: 10, y: 5 }, { x: 0, y: 0 }), {
    left: -22,
    top: -65,
    right: 32,
    bottom: 5,
  });
  assert.equal(mobRect(undefined, { x: 0, y: 0 }), undefined);
  assert.equal(
    mobRect({ bounds: { left: 0, top: 0, right: 0, bottom: 0 } }, { x: 0, y: 0 }),
    undefined,
  );
  assert.equal(
    intersects({ left: 0, top: 0, right: 1, bottom: 1 }, { left: 1, top: 0, right: 2, bottom: 1 }),
    false,
  );
  assert.equal(
    intersects(playerContactRect({ x: 0, y: 0 }), mobContactRect(f, { x: 0, y: 0 })),
    true,
  );
  const swept = mobRect(f, { x: 10, y: 10 }, false, { x: -10, y: -10 });
  assert.deepEqual(swept, { left: -28, top: -36, right: 29, bottom: 10 });
});

test("knockback comes from relative displacement and bounded pending-force/velocity merges", () => {
  assert.deepEqual(
    contactImpulse({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 99, y: 0 }, { x: 99, y: 0 }),
    { x: -270, y: -270 },
  );
  assert.deepEqual(
    contactImpulse({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 10 }, { x: 0, y: 0 }),
    { x: 270, y: 0 },
  );
  assert.deepEqual(
    contactImpulse({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }),
    { x: 0, y: -270 },
  );
  assert.equal(mergeImpulse(125, -270), -145, "do not overwrite walking velocity");
  assert.equal(mergeImpulse(-125, -270), -270, "bounded in same direction");
  assert.equal(mergeImpulse(-400, -270), -400, "do not reduce an already stronger velocity");
  assert.equal(
    mergeImpulse(500, -270),
    230,
    "a fast downward fall is not an unconditional upward jump",
  );
  assert.equal(mergeImpulse(12, 0), 12);
});

test("signed 1500ms protection, native 30ms tint phase, MISS without a newly applied tint, reset", () => {
  const clock = contactClock();
  clock.accept(1);
  assert.equal(clock.remaining, 1500);
  clock.step(29);
  assert.equal(clock.remaining, 1500);
  clock.step(1);
  assert.equal(clock.remaining, 1470);
  assert.equal(clock.tinted, true);
  clock.step(30);
  assert.equal(clock.tinted, false);
  clock.step(1440);
  assert.equal(clock.ready, true);
  clock.reset();
  clock.accept(0);
  clock.step(30);
  assert.equal(clock.remaining, -1470);
  assert.equal(clock.tinted, false);
  clock.step(1470);
  assert.equal(clock.ready, true);
  assert.equal(clock.tinted, false);
  clock.accept(7);
  clock.step(3600000);
  assert.equal(clock.ready, true);
  assert.equal(clock.tinted, false);
  clock.accept(7);
  clock.reset();
  assert.equal(clock.ready, true);
  assert.equal(clock.tinted, false);
});

test("revive uses native kind=0, empty name, not an operator warp or local stat mutation", () => {
  assert.deepEqual(
    [...encodeClientInteract({ kind: INTERACT_KIND_REVIVE, name: "" })],
    [0x0d, 0, 0, 0, 0, 0, 0],
  );
});

const path = fileURLToPath(new URL("../../Data.wz", import.meta.url));
test(
  "real WZ canvas properties: bodyAttack, lt/rb, 600ms hit1, 180ms missing delay, violet Miss, hit face",
  { skip: !existsSync(path) },
  () => {
    const archive = WzArchive.open(path),
      reader = artReaderOf(archive)!;
    const art = mobArtOf(100100, reader)!;
    assert.equal(art.bodyAttack, true);
    assert.equal(loadMobTemplate(archive, 100100)!.bodyAttack, true);
    assert.deepEqual(art.actions.hit1![0]!.bounds, {
      left: -21,
      top: -33,
      right: 22,
      bottom: 0,
    });
    assert.equal(art.actions.hit1![0]!.delay, 600);
    assert.equal(art.actions.stand![0]!.delay, 180);
    assert.ok(reader.at("Effect/BasicEff.img/NoViolet0/Miss")!.width > 0);
    const look = { faceId: 20000, hairId: 30000, items: [] };
    const neutral = composeAvatar(archive, look, {
      reader,
      stance: "stand1",
      frame: 0,
    })!;
    const hit = composeAvatar(archive, look, {
      reader,
      stance: "stand1",
      frame: 0,
      emotion: "hit",
    })!;
    assert.notDeepEqual(hit.png, neutral.png, "emotion must reach the compositor");
    assert.ok(
      hit.damageOriginY! >= -hit.dy,
      "damage anchor preserves untrimmed origin, not PNG height",
    );
    assert.ok(composeAvatar(archive, look, { reader, stance: "dead", frame: 0 }));
  },
);
