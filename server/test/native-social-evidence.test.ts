/** Read-only EXE / C / listing / complete original WZ subtree. No generated evidence dependency. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { originalPe } from "./fixtures/original-pe.ts";
import { readFunctions, decodeLiteral } from "../../tools/decompile.ts";
import { WzArchive } from "../src/wz/archive.ts";
import { entriesOf } from "../src/wz/props.ts";
import { partyCommandLines, partyInfo, partyState } from "../../client/party-state.ts";
import { parseSocialCommand } from "../../client/social-commands.ts";

test("native559E20 dispatch handles only3/4/5, not a missing Party window; PE machine code / C / listing / WZ cross-check", () => {
  const exe = originalPe("MapleStory.exe");
  assert.equal(
    exe.bytesAt(0x559ef5, 27).toString("hex"),
    "8b819800000083e8030f84b8000000487413480f85590100008bcd",
  );
  const functions = readFunctions(resolve(import.meta.dirname, "../../MapleStory.exe.c"));
  const body = (name: string) => {
    const fn = functions.get(name);
    assert.ok(fn);
    return fn.lines.map(decodeLiteral).join("\n");
  };
  const menu = body("sub_559E20");
  assert.ok(menu);
  assert.deepEqual(
    [...menu.matchAll(/case (\d+):/g)].map((m) => Number(m[1])),
    [3, 4, 5],
  );
  const info = body("sub_55CC40");
  assert.match(info, /src = this \+ 432/);
  assert.match(info, /i = 6/);
  assert.match(info, /src \+= 13/);
  for (const symbol of ["sub_471CD0", "sub_471E90", "sub_472050", "sub_4722E0"])
    assert.match(body(symbol), /sub_4FB670/);
  const listing = readFileSync(resolve(import.meta.dirname, "../../MapleStory.exe.lst"), "latin1");
  assert.match(listing, /00559EFB[^\r\n]+sub\s+eax, 3/);
  assert.match(listing, /00559F08[^\r\n]+jnz\s+loc_55A067/);
  const props = entriesOf(
    WzArchive.open(resolve(import.meta.dirname, "../../Data.wz")).objects("UI/UIWindow.img")[0],
  ).map((p) => p.name);
  assert.ok(props.includes("GameMenu") && props.includes("Trade") && props.includes("Messenger"));
  assert.equal(
    props.includes("Party"),
    false,
    "this exact UIWindow tree has no Party subtree; not a claim about every possible original UI",
  );
});
test("CP949 original command names and local guard/info strings, including punctuation and six slots", () => {
  const exe = originalPe("MapleStory.exe");
  for (const [va, text] of [
    [0x5b5fa4, "/파티정보"],
    [0x5b5f98, "/파티만들기"],
    [0x5b5f8c, "/파티탈퇴"],
    [0x5b5f80, "/파티초대"],
    [0x5b5f74, "/파티강퇴"],
    [0x5b5fc0, "/귓속말"],
    [0x5b5fb8, "/찾기"],
  ] as const) {
    assert.equal(exe.ansi(va), text);
    assert.ok(parseSocialCommand(text));
  }
  for (const kind of ["notLeader", "targetNotFound", "alreadyInParty", "notInParty"] as const)
    assert.ok(exe.containsCp949(partyCommandLines({ kind })[0]!));
  assert.ok(exe.containsCp949(partyCommandLines({ kind: "memberNotFound", name: "%s" })[0]!));
  assert.equal(exe.ansi(0x5c0354), "파티원:");
  assert.equal(exe.ansi(0x5c033c), "당신은 파티장입니다.");
  const state = partyState();
  state.receive({ kind: "created", partyId: 1 }, 7, "Leader");
  assert.deepEqual(partyInfo(state, 7), [exe.ansi(0x5c0354) + " Leader     ", exe.ansi(0x5c033c)]);
});
