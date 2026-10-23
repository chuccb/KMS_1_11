/** Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SOUND_DEFAULTS,
  nativeVolume,
  soundSettings,
  soundProfile,
  sliderCenter,
  sliderStep,
} from "../../client/systemsettings.ts";
import { moveQuickItem, clearQuickItem, quickItemProfile } from "../../client/quickslots.ts";
import { whisperNameError } from "../../client/whisper.ts";

import { createAudio } from "../../client/audio.ts";
const source = (name: string) =>
  readFileSync(new URL(`../../client/${name}`, import.meta.url), "utf8");

test("43DEB0: two 20-step channels, default15 = 80%, lowest=5%, independent mute", () => {
  assert.deepEqual(soundSettings(null), SOUND_DEFAULTS);
  assert.equal(nativeVolume(15), 0.8);
  assert.equal(nativeVolume(0), 0.05);
  assert.equal(nativeVolume(19), 1);
  assert.equal(nativeVolume(15, true), 0);
  assert.deepEqual(soundSettings({ bgm: -8, effects: 88, bgmMuted: true, effectsMuted: 0 }), {
    bgm: 0,
    effects: 19,
    bgmMuted: true,
    effectsMuted: false,
  });
  assert.equal(soundSettings({ bgm: NaN, effects: "19" }).bgm, 15);
  assert.equal(soundSettings({ bgm: NaN, effects: "19" }).effects, 15);
});
test("457280 + 457240 integer thumb centers and lower-index nearest tie, not percent rounding", () => {
  assert.equal(sliderCenter(0), 13);
  assert.equal(sliderCenter(19), 108);
  for (let i = 0; i < 20; i++) assert.equal(sliderStep(sliderCenter(i)), i);
  assert.equal(sliderStep(15.5), 0);
  assert.equal(sliderStep(-1000), 0);
  assert.equal(sliderStep(1000), 19);
  assert.equal(sliderCenter(3, 180, 4), 166);
});
test("sound profile is local-machine scope, copy-safe, blocked/corrupt storage safe", () => {
  let saved = "broken";
  const storage = {
    getItem: () => saved,
    setItem: (_k: string, v: string) => {
      saved = v;
    },
  };
  const profile = soundProfile(storage);
  assert.deepEqual(profile.values(), SOUND_DEFAULTS);
  const snapshot = profile.values();
  snapshot.bgm = 2;
  assert.equal(profile.values().bgm, 15);
  profile.save({ bgm: 2, effects: 18, bgmMuted: true });
  assert.equal(soundProfile(storage).values().bgm, 2);
  assert.equal(soundProfile(storage).values().bgmMuted, true);
  const blocked = {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
  };
  assert.doesNotThrow(() => soundProfile(blocked).save(SOUND_DEFAULTS));
});
test("463DF0/463F10 status rebind replaces destination, clears source, no swap, stale snapshot refused", () => {
  const values = [2000000, 2000001, null, null, null, null, null];
  assert.deepEqual(moveQuickItem(values, 0, 1), [null, 2000000, null, null, null, null, null]);
  assert.deepEqual(values, [2000000, 2000001, null, null, null, null, null]);
  assert.deepEqual(moveQuickItem(values, 0, 0), values);
  assert.equal(moveQuickItem(values, 0, 7), undefined);
  assert.equal(moveQuickItem(values, 0, 1, 2000002), undefined);
  assert.deepEqual(clearQuickItem(values, 0), [null, 2000001, null, null, null, null, null]);
  const p = quickItemProfile(undefined, "isolated");
  p.bind(1, 2000000);
  p.bind(3, 2000001);
  assert.ok(p.move(1, 3, 2000000));
  assert.equal(p.values()[1], null);
  assert.equal(p.values()[3], 2000000);
  assert.equal(p.clear(3, 2000001), false);
  assert.ok(p.clear(3, 2000000));
  assert.deepEqual(p.values(), Array(7).fill(null));
});
test("4F8940/524A00: recipient CP949 bytes, not JS glyph count or UTF8; not self; no new-character blacklist", () => {
  assert.equal(whisperNameError("Alice"), undefined);
  assert.ok(whisperNameError("Alice", "aLICE"));
  assert.equal(whisperNameError("가나"), undefined);
  assert.equal(whisperNameError("가나다라마바"), undefined);
  assert.ok(whisperNameError("가나다라마바사"));
  assert.ok(whisperNameError("abc"));
  assert.ok(whisperNameError("abc def"));
  assert.ok(whisperNameError("llll"));
  assert.ok(whisperNameError("한😀글"));
  assert.ok(whisperNameError("힣힣")); // UHC syllable is outside native B0..C8 A1..FE name range.
});
test("audio settings update already-created gains, preserve BGM clock, separate channel mute", async () => {
  const gains: { gain: { value: number }; connect(): void }[] = [];
  const context = {
    destination: {},
    resume: async () => {},
    createGain() {
      const gain = { gain: { value: 0 }, connect() {} };
      gains.push(gain);
      return gain;
    },
  };
  const audio = createAudio({ createContext: () => context as unknown as AudioContext });
  await audio.unlock();
  assert.equal(gains[0]!.gain.value, 0.8);
  assert.equal(gains[1]!.gain.value, 0.8);
  audio.applySettings({ bgm: 0, effects: 19, bgmMuted: true });
  assert.equal(gains[0]!.gain.value, 0);
  assert.equal(gains[1]!.gain.value, 1);
  audio.setMuted(true);
  assert.equal(gains[1]!.gain.value, 0);
  audio.setMuted(false);
  assert.equal(gains[0]!.gain.value, 0);
  assert.equal(gains[1]!.gain.value, 1);
  audio.applySettings(SOUND_DEFAULTS);
  assert.equal(gains[0]!.gain.value, 0.8);
});
test("renderer/input wiring: original paths, preview/cancel, local stale-action ticket, item drag is not slot/drop packet", () => {
  const menu = source("systemmenu.ts"),
    main = source("main.js"),
    dialogs = source("itemdialogs.ts");
  assert.match(menu, /if\s*\(accept\)\s*profile\.save\(soundDraft\)/);
  assert.match(menu, /audio\.applySettings\(accept\s*\?\s*soundDraft\s*:\s*soundOriginal\)/);
  assert.match(menu, /SysOpt["']\s*\}\/backgrnd/);
  assert.match(menu, /sliding\.x/);
  assert.match(menu, /stopImmediatePropagation/);
  assert.match(main, /localActionEpoch !== interaction/);
  const quick = main.slice(
    main.indexOf("function beginQuickDrag"),
    main.indexOf("// A drag carries a source snapshot"),
  );
  assert.match(quick, /quickProfile\.move/);
  assert.match(quick, /quickProfile\.clear/);
  assert.match(quick, /d\.epoch!==itemEpoch/);
  assert.doesNotMatch(quick, /send\(/);
  assert.match(main, /drawWhisperRecipient\(\)/);
  assert.match(main, /beginUserRequest\(whisperRecipient,text\)/);
  assert.match(
    main,
    /quitToTitle\s*=\s*true;\s*clientTransport\.close\(1000,\s*["']return to title["']\)/,
  );
  assert.match(dialogs, /c\.mode === "text"/);
  assert.match(dialogs, /event.isComposing/);
});
