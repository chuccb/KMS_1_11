/** SOURCE ONLY, 2026-10-18: not executed (user owns functional verification). ADR-059. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PacketReader } from "../src/protocol/packet.ts";
import { toHex } from "../src/protocol/frame.ts";
import { encodeCp949 } from "../src/protocol/cp949.ts";
import { ClientSession } from "../src/client/session.ts";
import {
  encodeUserBalloon,
  readUserBalloon,
  encodeUserChat,
  encodeUserWhisperRefused,
  readUserWhisperRefused,
  encodeClientUserRequest,
  readClientUserRequest,
  USER_REQUEST_KIND,
  encodeUserFindAnswer,
} from "../src/protocol/field.ts";
import { encodeSystemNotice, readSystemNotice } from "../src/protocol/notice.ts";
import { GAME_DEFAULTS, gameProfile, gameSettings } from "../../client/gameoptions.ts";
import { wrapChatText, balloonLayout, followChat } from "../../client/chatlayout.ts";

test("43D360 game defaults and local migration: only explicit booleans, copy-safe, blocked storage safe", () => {
  assert.deepEqual(gameSettings(null), GAME_DEFAULTS);
  assert.equal(gameSettings({ whisper: 0 }).whisper, true);
  let saved: string | null = null;
  const storage = {
    getItem: (key: string) => (key === "kms111.minimap" ? '{"shown":false}' : saved),
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  };
  const p = gameProfile(storage);
  assert.equal(p.values().minimap, false);
  assert.equal(p.values().whisper, true);
  const copy = p.values();
  copy.whisper = false;
  assert.equal(p.values().whisper, true);
  p.save({ ...p.values(), whisper: false });
  assert.equal(gameProfile(storage).values().whisper, false);
  assert.doesNotThrow(() =>
    gameProfile({
      getItem() {
        throw Error();
      },
      setItem() {
        throw Error();
      },
    }).save(GAME_DEFAULTS),
  );
});
test("51D530/50B320 field speech is 0x1F id+text, never the 0x1A incoming whisper shape", () => {
  const value = { characterId: 7, text: encodeCp949("안녕") },
    packet = encodeUserBalloon(value);
  assert.equal(toHex(packet), "1f070000000400bec8b3e7");
  assert.deepEqual(readUserBalloon(new PacketReader(packet, 1)), value);
  assert.throws(() => readUserBalloon(new PacketReader(packet.slice(0, -1), 1)));
  assert.equal(encodeUserChat({ name: "Hero", text: value.text })[0], 0x1a);
});
test("472910 refusal: 0x23/0x22 has sender + own name; 0x1A/0x22 only names refuser", () => {
  const packet = encodeClientUserRequest({
    kind: USER_REQUEST_KIND.refuseWhisper,
    name: "Hero",
    text: encodeCp949("가나"),
  });
  assert.equal(toHex(packet), "232204004865726f0400b0a1b3aa");
  assert.deepEqual(readClientUserRequest(new PacketReader(packet, 1)), {
    kind: 0x22,
    name: "Hero",
    text: encodeCp949("가나"),
  });
  const answer = encodeUserWhisperRefused({ name: "Alt" });
  assert.equal(toHex(answer), "1a220300416c74");
  assert.deepEqual(readUserWhisperRefused(new PacketReader(answer, 1)), { name: "Alt" });
  assert.throws(() => readUserWhisperRefused(new PacketReader(Uint8Array.of(0x12, 0, 0))));
});
test("55CDE0 type0 system notice is not fake System whisper; unsupported center type rejected", () => {
  const packet = encodeSystemNotice(encodeCp949("hello"));
  assert.equal(toHex(packet), "1300050068656c6c6f");
  assert.deepEqual(readSystemNotice(new PacketReader(packet, 1)), { text: encodeCp949("hello") });
  assert.throws(() => readSystemNotice(new PacketReader(Uint8Array.of(1, 0, 0))));
});
test("4373A0 native balloon cells: 84px wrap, odd single-line columns, dead arrow taller, five-second lifetime", () => {
  const measure = (t: string) => t.length * 6;
  const one = balloonLayout("abc", measure);
  assert.equal(one.columns, 3);
  assert.equal(one.width, 48);
  assert.equal(one.height, 33);
  assert.equal(one.x, -21);
  assert.equal(one.arrowY, 20);
  const long = balloonLayout("a".repeat(15), measure);
  assert.equal(long.columns, 7);
  assert.equal(long.lines.length, 2);
  assert.equal(long.height, 47);
  assert.equal(balloonLayout("abc", measure, true).height, 35);
  assert.deepEqual(
    wrapChatText("abcdefghij", (t) => t.length, 8),
    ["abcdefgh", "     ij"],
  );
  assert.equal(followChat(false, 10, 5010), false);
  assert.equal(followChat(false, 10, 5011), true);
  assert.equal(followChat(true, 10, 10), true);
});
test("session: real channel discrimination, unknown id discarded, shared request gate, Korean own-name refusal", async () => {
  const session = new ClientSession({ host: "127.0.0.1", loginPort: 1 }),
    sent: Uint8Array[] = [],
    events: unknown[] = [];
  // Source-only fixture access, no connection or running server involved.
  const internal = session as unknown as {
    self: unknown;
    gameLink: unknown;
    handleFieldPacket(p: Uint8Array): void;
  };
  internal.self = { characterId: 7, name: "가나" };
  internal.gameLink = {
    send: async (p: Uint8Array) => {
      sent.push(p);
    },
  };
  session.onEvent((e) => events.push(e));
  internal.handleFieldPacket(encodeUserBalloon({ characterId: 7, text: encodeCp949("hi") }));
  assert.deepEqual(events.pop(), {
    kind: "chat",
    channel: "field",
    characterId: 7,
    name: "가나",
    text: "hi",
  });
  internal.handleFieldPacket(encodeUserBalloon({ characterId: 999, text: encodeCp949("hidden") }));
  assert.equal(events.length, 0);
  internal.handleFieldPacket(encodeUserChat({ name: "Hero", text: encodeCp949("private") }));
  assert.deepEqual(events.pop(), {
    kind: "chat",
    channel: "whisper",
    name: "Hero",
    text: "private",
  });
  await session.whisper("Hero", encodeCp949("one"));
  await assert.rejects(session.find("Hero"), /다른 요청/);
  internal.handleFieldPacket(encodeUserFindAnswer({ name: "Hero", mapId: -1 }));
  await session.find("Hero");
  internal.handleFieldPacket(Uint8Array.of(0x1a, 0x09)); // Malformed answer must not release the gate.
  await assert.rejects(session.find("Hero"), /다른 요청/);
  internal.handleFieldPacket(encodeUserWhisperRefused({ name: "Alt" }));
  await assert.rejects(session.find("Hero"), /다른 요청/); // 0x22 does not release it either.
  await session.refuseWhisper("Hero"); // Refusal bypasses the outgoing request gate, like 472910.
  assert.deepEqual(
    readClientUserRequest(new PacketReader(sent.at(-1)!, 1)).text,
    encodeCp949("가나"),
  );
});
test("wiring: original GameOpt paths, unavailable social controls disabled, private text never becomes a balloon", () => {
  const file = (name: string) =>
    readFileSync(new URL(`../../client/${name}`, import.meta.url), "utf8");
  const main = file("main.js"),
    menu = file("systemmenu.mjs"),
    log = file("chatlog.mjs");
  assert.match(menu, /x:317,y:177/);
  assert.match(menu, /i>=2/);
  assert.match(menu, /54,203,50,23/);
  assert.match(menu, /applyGame\(accept\?draft:original\)/);
  assert.match(main, /systemPanel.gameSettings.whisper/);
  assert.match(main, /channel==='field'/);
  assert.match(main, /kind:'speech'.*z:250210/);
  assert.match(log, /list.children.length>64/);
  assert.match(log, /wrapChatText/);
  assert.match(log, /lastScroll/);
});
