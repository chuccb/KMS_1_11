/** ADR-061 Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ClientSession, type ClientEvent } from "../src/client/session.ts";
import { questReplyFor } from "../src/client/questreply.ts";
import { NpcTalk } from "../src/game/dialogue.ts";
import { spriteFrames } from "../src/game/sprites.ts";
import { WzNode, type WzEntry } from "../src/wz/img.ts";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf, type ArtReader } from "../src/game/wzart.ts";
import {
  encodeQuestTalk,
  readQuestTalk,
  readQuestReply,
  type QuestTalkBody,
} from "../src/protocol/quest.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  dialogueRuns,
  dialogueLayout,
  dialogueButtons,
  dialogueTextBytes,
  dialogueInputError,
} from "../../client/npcdialogue-layout.ts";
import { utilTextFrameRects } from "../../client/utildialog.ts";
import { dialogueExample } from "../../client/dialogue-examples.ts";
const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const props = (...pairs: [string, unknown][]) =>
  new WzNode(
    "props",
    pairs.map(([name, value]) => ({ name, type: 9, value }) as WzEntry),
  );
const packet = (body: QuestTalkBody) => encodeQuestTalk({ unknownA: 0, npcId: 7, body });

test("535C60/532500: Prev/Next flags and final OK; ESC is not previous", () => {
  const talk = new NpcTalk(7, 2003, ["one", "two", "three"]);
  const body = () => readQuestTalk(new PacketReader(talk.packet(), 1)).body;
  assert.deepEqual(body(), { kind: "say", message: "one", unknownA: 0, unknownB: 1 });
  assert.equal(talk.previous(), undefined);
  talk.advance();
  assert.deepEqual(body(), { kind: "say", message: "two", unknownA: 1, unknownB: 1 });
  talk.advance();
  assert.deepEqual(body(), { kind: "say", message: "three", unknownA: 1, unknownB: 0 });
  assert.equal(talk.advance(), undefined);
  talk.previous();
  assert.equal(body().message, "two");
  const specs = dialogueButtons(body(), 322, 113);
  assert.deepEqual(
    specs.map((s: { name: string; answer: number }) => [s.name, s.answer]),
    [
      ["Close", 255],
      ["Prev", 0],
      ["Next", 1],
    ],
  );
  assert.deepEqual(specs[0], {
    key: "close",
    name: "Close",
    x: 274,
    y: 9,
    width: 32,
    height: 15,
    answer: 255,
  });
  assert.equal(
    dialogueButtons({ kind: "menu", message: "" }, 322, 92).length,
    1,
    "menu has only header Close",
  );
});

test("530C20/530CA0/535E40: native plain-text row sizes, scroll threshold and geometry", () => {
  const measure = (text: string) => text.length * 6;
  const say = dialogueLayout({ kind: "say", message: "x" }, measure);
  assert.equal(say.pieces[0].x, 8);
  assert.equal(say.textWidth, 300);
  assert.equal(say.textHeight, 34);
  assert.equal(say.width, 322);
  assert.equal(say.height, 113);
  const input = dialogueLayout({ kind: "askText", message: "x" }, measure);
  assert.equal(input.width, 252);
  assert.equal(input.textHeight, 22);
  assert.equal(input.height, 121);
  const long = dialogueLayout(
    { kind: "say", message: Array(20).fill("line").join("\r\n") },
    measure,
  );
  assert.equal(long.scrolling, true);
  assert.equal(long.width, 334);
  assert.equal(long.visibleHeight, 240);
  assert.equal(long.height, 319);
  assert.equal(long.maxScroll, Math.floor((long.textHeight - 240) / 8));
  const wrapped = dialogueLayout({ kind: "say", message: "x".repeat(51) }, measure);
  assert.equal(wrapped.pieces[1].y - wrapped.pieces[0].y, 18);
});

test("531FB0 listing: seven integer FillRects, two palettes, no guessed stroke rectangle", () => {
  const rects = utilTextFrameRects(11, 36, 300, 34, true);
  assert.deepEqual(rects, [
    { x: 12, y: 37, width: 298, height: 32, color: "#e4ddd3" },
    { x: 11, y: 36, width: 299, height: 1, color: "#947c6a" },
    { x: 11, y: 37, width: 1, height: 32, color: "#b39c7d" },
    { x: 11, y: 69, width: 1, height: 1, color: "#d2c6ba" },
    { x: 310, y: 36, width: 1, height: 1, color: "#d2c6ba" },
    { x: 12, y: 69, width: 299, height: 1, color: "#f2eeea" },
    { x: 310, y: 37, width: 1, height: 32, color: "#f2eeea" },
  ]);
  assert.equal(utilTextFrameRects(0, 0, 300, 34)[0].color, "#d3dbe4");
});

test("5338A0 bounded markup preserves unsupported codes and sparse menu values", () => {
  const runs = dialogueRuns("#rred#e bold#n#k\r\n#L42##bchoice#l #i1000#");
  assert.equal(runs[0].color, "r");
  assert.equal(runs[1].bold, true);
  assert.ok(
    runs.some(
      (r: { selection?: number; text: string }) => r.selection === 42 && r.text === "choice",
    ),
  );
  assert.ok(runs.some((r: { kind?: string; id?: number }) => r.kind === "item" && r.id === 1000));
  assert.ok(
    dialogueRuns("#L-1#x")
      .map((r: { text: string }) => r.text)
      .join("")
      .includes("#L-1#"),
  );
});

test("text validation counts CP949 bytes and preserves whitespace; -1 is unbounded", () => {
  const body: QuestTalkBody = {
    kind: "askText",
    message: "",
    defaultText: "",
    minLength: 4,
    maxLength: 12,
  };
  assert.equal(dialogueTextBytes("메이플"), 6);
  assert.equal(dialogueTextBytes("abc "), 4);
  assert.equal(dialogueTextBytes("😀"), undefined);
  assert.equal(dialogueInputError(body, "메이플"), undefined);
  assert.ok(dialogueInputError(body, "가".repeat(7)));
  assert.ok(dialogueInputError(body, "😀"));
  assert.deepEqual(questReplyFor(body, 1, { text: " abc " }), {
    kind: "askText",
    answer: 1,
    text: " abc ",
  });
  assert.throws(() => questReplyFor(body, 1, { text: "😀" }), /CP949/);
  assert.throws(() => questReplyFor(body, 1, { text: "가".repeat(7) }), /CP949 bytes/);
  const unlimited = { ...body, minLength: -1, maxLength: -1 };
  assert.equal(dialogueInputError(unlimited, "가".repeat(20)), undefined);
  assert.equal(questReplyFor(unlimited, 1, { text: "가".repeat(20) }).answer, 1);
});

test("packet boundary validates current kind, actual ranges and offered menu values", () => {
  const body: QuestTalkBody = { kind: "askNumber", message: "", defaultValue: 1, min: 1, max: 99 };
  assert.ok(dialogueInputError(body, "-1"));
  assert.ok(dialogueInputError(body, "1.5"));
  assert.equal(dialogueInputError(body, "99"), undefined);
  assert.throws(() => questReplyFor(body, 1, { value: 100 }), /1\.\.99/);
  assert.throws(() => questReplyFor(body, 1, { value: "1" }), /unsigned/);
  assert.throws(() => questReplyFor(body, 1, { kind: "say", value: 1 }), /kind/);
  assert.throws(() => questReplyFor(body, 255), /answer/);
  assert.throws(() => questReplyFor({ kind: "say", message: "" }, 0), /previous/);
  assert.equal(questReplyFor({ kind: "say", message: "" }, 255).answer, 255);
  assert.throws(
    () => questReplyFor({ kind: "menu", message: "#L42#x#l" }, 1, { value: 0 }),
    /not offered/,
  );
  assert.equal(questReplyFor({ kind: "menu", message: "#L42#x#l" }, 1, { value: 42 }).answer, 1);
});

test("session retains all five 0x47 bodies and sends their actual sub-op once", async () => {
  const session = new ClientSession({ loginPort: 1 });
  const events: ClientEvent[] = [],
    sent: Uint8Array[] = [];
  session.onEvent((e) => events.push(e));
  const fake = session as unknown as {
    gameLink: { send(p: Uint8Array): Promise<void> };
    handleFieldPacket(p: Uint8Array): void;
  };
  fake.gameLink = {
    async send(p) {
      sent.push(p);
    },
  };
  const examples: QuestTalkBody[] = [
    { kind: "say", message: "x", unknownA: 1, unknownB: 1 },
    { kind: "confirm", message: "x" },
    { kind: "askText", message: "x", defaultText: "", minLength: 0, maxLength: 12 },
    { kind: "askNumber", message: "x", defaultValue: 1, min: 1, max: 9 },
    { kind: "menu", message: "#L42#x#l" },
  ];
  for (const body of examples) {
    fake.handleFieldPacket(packet(body));
    const event = events.at(-1);
    assert.equal(event?.kind, "npc-say");
    if (event?.kind === "npc-say") assert.deepEqual(event.body, body);
    await session.talk(1, { text: "abc ", value: body.kind === "menu" ? 42 : 3 });
    const reply = readQuestReply(new PacketReader(sent.at(-1)!, 1));
    assert.equal(reply.kind, body.kind);
    await assert.rejects(session.talk(1), /open NPC dialog/);
  }
});

test("next page arriving during write is not cleared, nor overwritten by a failed old write", async () => {
  const session = new ClientSession({ loginPort: 1 });
  const fake = session as unknown as {
    gameLink: { send(p: Uint8Array): Promise<void> };
    handleFieldPacket(p: Uint8Array): void;
  };
  fake.handleFieldPacket(packet({ kind: "say", message: "old" }));
  fake.gameLink = {
    async send() {
      fake.handleFieldPacket(
        packet({ kind: "askNumber", message: "new", defaultValue: 1, min: 1, max: 2 }),
      );
      throw new Error("write failed");
    },
  };
  await assert.rejects(session.talk(1), /write failed/);
  const sent: Uint8Array[] = [];
  fake.gameLink = {
    async send(p) {
      sent.push(p);
    },
  };
  await session.talk(1, { value: 2 });
  assert.equal(readQuestReply(new PacketReader(sent[0]!, 1)).kind, "askNumber");
});

test("40C730 default NPC frame delay is 180ms; map defaults and explicit delays remain unchanged", () => {
  const reader: ArtReader = {
    size: 0,
    clear() {},
    node: (path) => (path.endsWith("/stand") ? props(["0", props()]) : props()),
    at: () => ({
      width: 1,
      height: 1,
      ox: 0,
      oy: 0,
      z: 0,
      rgba: new Uint8Array(4),
      png: new Uint8Array(),
    }),
  };
  assert.equal(spriteFrames(reader, "Npc/0002003.img", "stand", [])[0]!.delay, 180);
  assert.equal(spriteFrames(reader, "Mob/0000100.img", "stand", [])[0]!.delay, 180);
  assert.equal(spriteFrames(reader, "Map/Back/test.img", "stand", [])[0]!.delay, 1000);
  assert.equal(spriteFrames(reader, "Npc/0002003.img", "stand", [], 91)[0]!.delay, 91);
});

test("UI examples are local/read-only and real packets supersede them; source isolation stays wired", () => {
  for (const kind of ["say", "confirm", "askText", "askNumber", "menu"])
    assert.match(dialogueExample(kind)!.message, /UI PREVIEW - not an NPC quest/);
  const main = source("../../client/main.js"),
    dialogue = source("../../client/npcdialogue.ts");
  // f4e0f57 (tooltip restoration) widened the supersede guard to the tooltip example as well;
  // a real server dialog still always closes the local example first.
  assert.match(main, /if \(npcDialog\.preview \|\| tooltipViewer\.open\) closeDialogue\(false\)/);
  assert.match(main, /context\?\.preview/);
  assert.match(main, /onReply\(reply, context\)/);
  assert.match(dialogue, /event\.stopImmediatePropagation\(\)/);
  assert.match(dialogue, /releaseOnInterrupt/);
  assert.match(dialogue, /released !== spec\.key/);
  assert.doesNotMatch(dialogue, /innerHTML\s*=/);
  assert.match(dialogue, /BtUIClose2/);
  assert.match(dialogue, /UtilDlgEx2/);
});

const data = fileURLToPath(new URL("../../Data.wz", import.meta.url));
test(
  "archive contains Ex2 border, all dialog button states and the distinct 32x15 Close2",
  { skip: !existsSync(data) },
  () => {
    const archive = WzArchive.open(data),
      reader = artReaderOf(archive)!;
    for (let i = 0; i < 8; i++) assert.ok(reader.at(`UI/UIWindow.img/UtilDlgEx2/Border/${i}`));
    for (const name of ["Prev", "Next", "OK", "Yes", "No", "Cancel"])
      for (const state of ["normal", "mouseOver", "pressed"]) {
        const art = reader.at(`UI/UIWindow.img/UtilDlgEx2/Bt${name}/${state}/0`)!;
        assert.equal(art.width, 50);
        assert.equal(art.height, 23);
      }
    const close = reader.at("UI/UIWindow.img/BtUIClose2/normal/0")!;
    assert.equal(close.width, 32);
    assert.equal(close.height, 15);
  },
);
