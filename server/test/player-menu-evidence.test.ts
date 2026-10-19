/** EXE/real WZ cross-checks support the manual C/listing investigation, not original runtime parity. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { originalPe } from "./fixtures/original-pe.ts";
import { WzArchive } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { PLAYER_MENU, playerMenuRows } from "../../client/player-menu-data.ts";
import { fameMessage } from "../../client/fame.ts";
import { partyMessage, partyInvitationText } from "../../client/party.ts";

test("original EXE ContextMenu full UTF16 path, CP949 menu labels and fame/party message literals", () => {
  const exe = originalPe("MapleStory.exe");
  assert.equal(exe.wide(0x5be89c), "UI/UIWindow.img/ContextMenu");
  const rows = playerMenuRows("title", true);
  for (const [index, address] of [
    0x5bd8e4, 0x5bd8d8, 0x5bd8cc, 0x5bd8c4, 0x5bd8b8, 0x5bd8ac,
  ].entries())
    assert.equal(rows[index + 1]?.text, exe.ansi(address));
  for (const kind of ["changed", "received"] as const)
    for (const up of [true, false])
      assert.ok(exe.containsCp949(fameMessage({ kind, name: "%s", up }, "%s")!));
  for (const kind of [
    "beginner",
    "alreadyToday",
    "alreadyThisMonth",
    "notFound",
    "cooldown",
  ] as const)
    assert.ok(exe.containsCp949(fameMessage({ kind }, "")!));
  assert.ok(exe.containsCp949(fameMessage({ kind: "unknown", type: 255 }, "")!));
  for (const kind of [
    "alreadyInParty",
    "beginnerCannotCreate",
    "notInParty",
    "full",
    "unknown",
  ] as const)
    assert.ok(exe.containsCp949(partyMessage({ kind }, 1, "")!));
  assert.ok(exe.containsCp949(partyMessage({ kind: "created", partyId: 1 }, 1, "")!));
  for (const leaderId of [1, 2])
    assert.ok(exe.containsCp949(partyMessage({ kind: "ended", partyId: 1, leaderId }, 1, "")!));
  assert.ok(exe.containsCp949(partyInvitationText("%s")));
});
test("original WZ ContextMenu four canvases81x3/81x15/81x15/89x18 and native(-8,0)/(0,0) origins", () => {
  const reader = artProviderOf(
    WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")),
  ).reader;
  assert.ok(reader);
  for (const [index, [w, h]] of [
    [81, 3],
    [81, 15],
    [81, 15],
    [89, 18],
  ].entries()) {
    const art = reader.at(`${PLAYER_MENU.path}${index}`);
    assert.ok(art);
    assert.deepEqual([art.width, art.height, art.ox, art.oy], [w, h, index < 3 ? -8 : 0, 0]);
    assert.equal(art.rgba.length, w * h * 4);
  }
});
