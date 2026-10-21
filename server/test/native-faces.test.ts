/** Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf } from "../src/game/wzart.ts";
import { faceAnimationOf, faceFramePath } from "../src/game/face.ts";
import { composeAvatarBitmap } from "../src/game/avatar.ts";
import { artProviderOf } from "../src/game/art.ts";
import { EMOTION_HIT, EMOTION_MAX, EMOTION_NAMES, EMOTION_NEUTRAL } from "../src/protocol/field.ts";

import type { FaceActor } from "../../client/faces.ts";
import {
  FACE_NAMES,
  facePose,
  setFace,
  resetFace,
  faceIdleDelay,
  faceBlinkCount,
  faceFrameAt,
  faceProfiles,
  movementFace,
} from "../../client/faces.ts";
const data = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const profile = {
  faceId: 20000,
  actions: {
    blink: {
      duration: 5000,
      frames: [
        { index: 0, delay: 60 },
        { index: 1, delay: 60 },
        { index: 2, delay: 60 },
      ],
    },
    hit: { duration: 5000, frames: [{ index: 0, delay: 60 }] },
    smile: { duration: 5000, frames: [{ index: 0, delay: 60 }] },
    vomit: {
      duration: 5000,
      frames: [
        { index: 0, delay: 120 },
        { index: 1, delay: 120 },
      ],
    },
  },
};

test("native names, 2000..4999 idle interval and 1..3 blinks, never combat RNG", () => {
  assert.deepEqual(FACE_NAMES, [...EMOTION_NAMES]);
  assert.deepEqual([faceIdleDelay(() => 0), faceIdleDelay(() => 0.999999)], [2000, 4999]);
  assert.deepEqual([faceBlinkCount(() => 0), faceBlinkCount(() => 0.999999)], [1, 3]);
  assert.equal(
    faceFrameAt(
      [
        { index: 2, delay: 60 },
        { index: 7, delay: 120 },
      ],
      60,
    ),
    7,
    "not body array index",
  );
});

test("independent face/body clocks; strict expiry; idle once/burst; replacement and snapshot persistence", () => {
  const actor: FaceActor = {};
  assert.equal(facePose(actor, "look", profile, 0, () => 0).emotion, undefined);
  assert.equal(
    facePose(actor, "look", profile, 2000, () => 0).emotion,
    undefined,
    "native compares >",
  );
  assert.equal(facePose(actor, "look", profile, 2001, () => 0).frame, 0);
  assert.equal(facePose(actor, "look", profile, 2061, () => 0).frame, 1);
  assert.equal(facePose(actor, "look", profile, 2121, () => 0).frame, 2);
  assert.equal(
    facePose(actor, "look", profile, 2181, () => 0).emotion,
    undefined,
    "one blink, not infinite loop",
  );
  setFace(actor, 2, 3000);
  assert.equal(facePose(actor, "look", profile, 8000, () => 0).emotion, "smile");
  assert.equal(
    facePose(actor, "look", profile, 8001, () => 0).emotion,
    undefined,
    "5000 not old 2500",
  );
  setFace(actor, 1, 9000, 1500);
  const snapshot = { ...actor, hp: 12 };
  assert.equal(facePose(snapshot, "look", profile, 10500, () => 0).emotion, "hit");
  assert.equal(facePose(snapshot, "look", profile, 10501, () => 0).emotion, undefined);
  setFace(snapshot, 8, 11000);
  assert.equal(facePose(snapshot, "look", profile, 11120, () => 0).frame, 1);
  assert.equal(
    facePose(snapshot, "new hat", profile, 11121, () => 0).emotion,
    undefined,
    "SetAvatar resets even same face",
  );
  assert.equal(setFace(snapshot, 8, 12000, -1, "prone"), false);
  assert.equal(setFace(snapshot, 8, 12000, -1, "proneStab"), false);
  assert.equal(setFace(snapshot, 9, 12000), false);
  resetFace(snapshot);
  assert.equal(snapshot.faceClock, undefined);
});

test("three blink cycles finish then schedule a new idle; hit interrupts blink; explicit neutral resets", () => {
  const actor: FaceActor = {};
  facePose(actor, "a", profile, 0, () => 0);
  facePose(actor, "a", profile, 2001, () => 0.999999);
  assert.equal(actor.faceClock!.blinking!.until, 2541);
  assert.equal(facePose(actor, "a", profile, 2500, () => 0).emotion, "blink");
  setFace(actor, 1, 2501, 1500);
  assert.equal(facePose(actor, "a", profile, 2501, () => 0).emotion, "hit");
  setFace(actor, 0, 2502);
  assert.equal(facePose(actor, "a", profile, 2502, () => 0).emotion, undefined);
  assert.equal(actor.faceClock!.next, 4502);
  assert.equal(actor.faceClock!.blinking, undefined);
});

test("495F70 attr OR precedes consumption; short/zero fragments, tail quantum, no repeat or late entry hit", () => {
  const actor: FaceActor = {
    motion: {
      start: 100,
      elements: [
        { attr: 0, duration: 5 },
        { attr: 2, duration: 5 },
        { attr: 0, duration: 100 },
      ],
    },
  };
  movementFace(actor, 100);
  assert.equal(actor.emotion, undefined);
  movementFace(actor, 130);
  assert.deepEqual(actor.emotion, { value: 1, at: 130, duration: 1500 });
  const first = actor.emotion;
  movementFace(actor, 131);
  assert.equal(actor.emotion, first);
  const zero: FaceActor = {
    motion: {
      start: 0,
      elements: [
        { attr: 2, duration: 0 },
        { attr: 0, duration: 100 },
      ],
    },
  };
  movementFace(zero, 0);
  assert.equal(zero.emotion!.at, 0);
  const tail: FaceActor = { motion: { start: 0, elements: [{ attr: 2, duration: 100 }] } };
  movementFace(tail, 99);
  tail.motion = undefined;
  movementFace(tail, 120);
  assert.equal(tail.emotion!.at, 120);
  const last = tail.emotion;
  movementFace(tail, 150);
  assert.equal(tail.emotion, last);
  const future: FaceActor = {
    motion: {
      start: 0,
      elements: [
        { attr: 0, duration: 300 },
        { attr: 2, duration: 100 },
      ],
    },
  };
  movementFace(future, 0);
  assert.equal(future.emotion, undefined, "not on socket receipt of a future fragment");
});

test("face metadata retry/backoff and eviction abort; late data never writes an actor", async () => {
  let calls = 0,
    clock = 0;
  const cache = faceProfiles({
    now: () => clock,
    fetcher: async () => {
      calls++;
      return { ok: false, status: 404 };
    },
  });
  await cache.get(20000)!.promise;
  cache.get(20000);
  assert.equal(calls, 1);
  clock = 5000;
  await cache.get(20000)!.promise;
  assert.equal(calls, 2);
  let signal: AbortSignal | undefined;
  const other = faceProfiles({
    limit: 1,
    fetcher: async (_url: string, options: { signal: AbortSignal }) => {
      signal ??= options.signal;
      return { ok: true, json: async () => profile };
    },
  });
  const old = other.get(20000);
  await Promise.resolve();
  other.get(21000);
  assert.equal(signal?.aborted, true);
  await old!.promise;
  other.clear();
});

test(
  "real WZ: face delays and default duration, exact frame path, animated masks, mirrored/rear composition",
  { skip: !existsSync(data) },
  () => {
    const wz = WzArchive.open(data),
      reader = artReaderOf(wz)!;
    const face = faceAnimationOf(reader, 20000)!;
    assert.deepEqual(face.actions.blink.frames, [
      { index: 0, delay: 60 },
      { index: 1, delay: 60 },
      { index: 2, delay: 60 },
    ]);
    assert.equal(face.actions.smile.duration, 5000);
    assert.equal(face.actions.smile.frames[0].delay, 60);
    assert.deepEqual(
      face.actions.vomit.frames.map((f) => f.delay),
      [120, 120],
    );
    assert.equal(faceFramePath(reader, "Character/Face/00020000.img", "blink", 8), undefined);
    assert.equal(faceAnimationOf(reader, -1), undefined);
    const provider = artProviderOf(wz);
    for (const flip of [false, true]) {
      const look = { faceId: 20000, hairId: 30000, items: [1040002, 1060002, 1072001] };
      const a = composeAvatarBitmap(wz, look, { frame: 0, emotion: "blink", faceFrame: 0, flip })!;
      const b = composeAvatarBitmap(wz, look, { frame: 0, emotion: "blink", faceFrame: 1, flip })!;
      assert.notDeepEqual(b.bitmap, a.bitmap, "body frame constant, face advances");
      const masked = composeAvatarBitmap(
        wz,
        { ...look, items: [...look.items, 1012000] },
        { emotion: "blink", faceFrame: 1, flip },
      )!;
      assert.notDeepEqual(
        masked.bitmap,
        b.bitmap,
        "101 accessory is not a missing stance or an icon",
      );
      const back = composeAvatarBitmap(wz, look, {
        stance: "rope",
        frame: 0,
        emotion: "smile",
        flip,
      })!;
      const backMasked = composeAvatarBitmap(
        wz,
        { ...look, items: [...look.items, 1012000] },
        { stance: "rope", frame: 0, emotion: "smile", flip },
      )!;
      assert.deepEqual(backMasked.bitmap, back.bitmap, "back-facing body face=0 hides both");
    }
    const look = { face: 20000, hair: 30000, items: [] };
    assert.notDeepEqual(
      provider.avatar(look, { emotion: "blink", faceFrame: 0 })!.png,
      provider.avatar(look, { emotion: "blink", faceFrame: 1 })!.png,
      "PNG cache must include independent face frame",
    );
  },
);

test("integration source: native F1..F7, no local echo reset, shared creation/selection clock, guarded requests", () => {
  const main = source("../../client/main.js"),
    web = source("../src/net/webclient.ts"),
    creation = source("../../client/creation.ts");
  assert.match(main, /\^F\[1-7\]/);
  assert.match(main, /!event\.repeat\) requestEmotion/);
  // The independent face-frame remains in both the delegated cache key and avatar HTTP query.
  assert.match(main, /avatarCache\.get\(look, stance, frame, flip, emotion, planes, faceFrame\)/);
  const images = source("../../client/image-cache.ts");
  assert.match(images, /emotion \?\? "default",\s*faceFrame,\s*planes/);
  assert.match(images, /faceFrame: String\(faceFrame\)/);
  assert.match(main, /message\.characterId === selfView\?\.characterId\) return/);
  assert.match(main, /face: sampleAvatarFace/);
  const login = source("../../client/login-screen.ts"),
    painting = source("../../client/login-presentation.ts");
  assert.match(login, /drawSelectionScreen\(options,/);
  assert.match(painting, /face: sampleFace/);
  assert.match(painting, /sampleFace\(character, look, now\)/);
  assert.match(creation, /face\(previewActor, look, now\)/);
  assert.match(web, /\/api\/face\//);
  assert.match(web, /faceFrame: faceIndex/);
  assert.match(source("../src/net/loginserver.ts"), /plain\.length !== 5.*exactly one u32 emotion/);
});

test("the nine faces and the F1..F7 mapping are the original's table, not a local convention", () => {
  // .data:005B20D8 is nine wchar_t* in this order; .data:005B20FC then starts the avatar-action
  // table (move, stand, jump, ...), which is a different list entirely.
  assert.deepEqual(
    [...EMOTION_NAMES],
    ["blink", "hit", "smile", "troubled", "cry", "angry", "bewildered", "stunned", "vomit"],
  );
  assert.deepEqual(FACE_NAMES, [...EMOTION_NAMES]);
  assert.equal(EMOTION_MAX, 8);
  assert.equal(EMOTION_NEUTRAL, 0, "sub_408400 clamps n8 > 8 back to the neutral blink");
  assert.equal(EMOTION_HIT, 1, "sub_5114A0 shows the hurt face on its own when hit");
  // sub_511E20 case 10 tests (unsigned int)(n119 - 111) <= 8 with VK_F1 = 112, so F1..F7 carry
  // 1..7 and the two ends - 0 (blink) and 8 (vomit) - have no key at all; F8 (119) returns
  // before the range test. The page must not shift that mapping by one.
  const main = source("../../client/main.js");
  assert.match(main, /const EMOTE_KEYS = \[1, 2, 3, 4, 5, 6, 7\];/);
  assert.match(main, /requestEmotion\(Number\(event\.key\.slice\(1\)\)\)/);
});
