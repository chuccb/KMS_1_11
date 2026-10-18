/**
 * The NPC pool: the codec of `0x39`/`0x3A`/`0x3B` and the field that turns a map's `life` list into
 * packets (FINDINGS 4.19).
 *
 * The golden bytes here come from `sub_49F6C0` (`0x39`), `sub_49F810` (`0x3A`) and `sub_49F970`
 * (`0x3B`) - the client's own reader, field for field. What the test cannot prove is where the client
 * *draws* the NPC: only the oracle run (ADR-004) can, so the assertions stop at the wire.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  NPC_OPCODE,
  describeNpcEnterField,
  encodeNpcEnterField,
  encodeNpcLeaveField,
  encodeNpcState,
  readNpcEnterField,
  readNpcId,
  readNpcState,
} from "../src/protocol/npc.ts";
import { describeFieldPacket } from "../src/protocol/field.ts";
import { NpcField, npcWalkPolicy } from "../src/game/npcs.ts";
import { npcImagePath } from "../src/wz/paths.ts";
import type { LifeSpawn } from "../src/game/map.ts";

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const heena: LifeSpawn = {
  templateId: 1012000,
  x: 69,
  y: 275,
  foothold: 28,
  facing: 0,
  rx0: 0,
  rx1: 0,
  cy: 275,
};

test("0x39 for an unknown id is the template plus the six-field body", () => {
  const bytes = encodeNpcEnterField({
    npcId: 1,
    templateId: 1012000,
    x: 69,
    y: 275,
    facing: 0,
  });
  // opcode, npcId(4), templateId(4), x(2), y(2), facing(1), lookupKey(2), pointX/pointY(4)
  assert.equal(bytes.length, 20, "the body is 19 bytes for a new id, plus the opcode");
  assert.equal(bytes[0], NPC_OPCODE.enterField);
  assert.equal(describeNpcEnterField(readNpcEnterField(new PacketReader(bytes, 1), false)),
    "npcId=1 template=1012000 at (69,275) facing=0 lookupKey=0");
  // 1012000 = 0x000F7120 -> little endian; 69 = 0x0045, 275 = 0x0113
  assert.equal(toHex(bytes.slice(0, 13)), "39" + "01000000" + "20710f00" + "4500" + "1301");
});

test("0x39 for a known id is five bytes and means 'refresh, read nothing'", () => {
  const bytes = encodeNpcEnterField({ npcId: 7, templateId: undefined, x: 0, y: 0, facing: 0 });
  assert.equal(bytes.length, 5);
  assert.deepEqual([...bytes], [NPC_OPCODE.enterField, 7, 0, 0, 0]);
  assert.equal(
    describeNpcEnterField(readNpcEnterField(new PacketReader(bytes, 1), true)),
    "npcId=7 (known id: refresh only)",
  );
});

test("negative coordinates survive the s16 fields", () => {
  const bytes = encodeNpcEnterField({ npcId: 3, templateId: 2000, x: -5, y: -300, facing: 1 });
  const back = readNpcEnterField(new PacketReader(bytes, 1), false);
  assert.equal(back.x, -5);
  assert.equal(back.y, -300);
  assert.equal(back.facing, 1);
});

test("0x3A is the id alone, 0x3B is the flag then the id", () => {
  assert.deepEqual([...encodeNpcLeaveField(0x1234)], [NPC_OPCODE.leaveField, 0x34, 0x12, 0, 0]);
  assert.deepEqual([...encodeNpcState(9, true)], [NPC_OPCODE.stateToggle, 1, 9, 0, 0, 0]);
  assert.deepEqual([...encodeNpcState(9, false)], [NPC_OPCODE.stateToggle, 0, 9, 0, 0, 0]);
  assert.deepEqual(readNpcState(new PacketReader(encodeNpcState(9, true), 1)), { npcId: 9, on: true });
  assert.equal(readNpcId(new PacketReader(encodeNpcLeaveField(9), 1)), 9);
});

test("the field dispatcher describes the NPC packet instead of calling it undecoded", () => {
  const text = describeFieldPacket(encodeNpcEnterField({ npcId: 1, templateId: 1012000, x: 69, y: 275, facing: 0 }));
  assert.match(text ?? "", /0x39 CNpcPool\(npc appear\): npcId=1 template=1012000/);
  assert.equal((text ?? "").includes("not decoded"), false);
  // A 5-byte packet is the refresh form - and the describer says both readings out loud.
  const refresh = describeFieldPacket(encodeNpcEnterField({ npcId: 4, templateId: undefined, x: 0, y: 0, facing: 0 }));
  assert.match(refresh ?? "", /npcId=4 \(known id: refresh only, or a truncated body\)/);
  assert.match(describeFieldPacket(new Uint8Array([NPC_OPCODE.enterField, 1])) ?? "", /truncated/);
  assert.match(describeFieldPacket(encodeNpcLeaveField(2)) ?? "", /npcId=2 leave/);
  assert.match(describeFieldPacket(encodeNpcState(2, false)) ?? "", /npcId=2 controller=off/);
});

test("spawning a map's life list gives one 0x39 per NPC, with ids from 1", () => {
  const field = new NpcField({
    spawns: [heena, { ...heena, templateId: 1010100, x: 100, y: 200, facing: 1 }],
    template: (id) => ({ templateId: id, name: id === 1012000 ? "헤네시스" : "로저" }),
  });
  const packets = field.spawnPackets();
  assert.equal(packets.length, 2);
  assert.deepEqual([...packets[0]!.slice(0, 5)], [NPC_OPCODE.enterField, 1, 0, 0, 0]);
  assert.deepEqual([...packets[1]!.slice(0, 5)], [NPC_OPCODE.enterField, 2, 0, 0, 0]);
  assert.equal(field.npcs[0]!.name, "헤네시스");
  assert.equal(field.npcs[1]!.x, 100);
  assert.equal(field.npcs[1]!.facing, 1);
  assert.equal(field.present, 2);
});

test("an NPC whose Npc/<id>.img is missing is skipped, not sent", () => {
  const lines: string[] = [];
  const field = new NpcField({
    spawns: [heena, { ...heena, templateId: 9999999 }],
    template: (id) => (id === 9999999 ? undefined : { templateId: id, name: "x" }),
    log: (line) => lines.push(line),
  });
  assert.equal(field.spawnPackets().length, 1, "only the NPC the archive has");
  assert.equal(field.npcs.length, 1);
  assert.ok(
    lines.some((line) => line.includes("9999999") && line.includes("not spawned")),
    lines.join("\n"),
  );
});

test("without a template source the spawns are kept, because the client loads the image", () => {
  const field = new NpcField({ spawns: [heena] });
  assert.equal(field.spawnPackets().length, 1);
  assert.equal(field.npcs[0]!.name, "");
});

test("removing and toggling follow the client's own rules", () => {
  const field = new NpcField({ spawns: [heena] });
  field.spawnPackets();
  const id = field.npcs[0]!.npcId;

  assert.equal(field.setWalking(999, true), undefined, "an unknown id has nothing to toggle");
  assert.deepEqual([...field.setWalking(id, true)!], [NPC_OPCODE.stateToggle, 1, id, 0, 0, 0]);
  assert.equal(field.setWalking(id, true), undefined, "already walking: the client does nothing");
  assert.notEqual(field.setWalking(id, false), undefined);
  assert.equal(field.walking, 0);

  assert.equal(field.remove(999), undefined);
  const leave = field.remove(id);
  assert.ok(leave);
  assert.deepEqual([...leave!], [NPC_OPCODE.leaveField, id, 0, 0, 0]);
  assert.equal(field.present, 0);
  assert.equal(field.remove(id), undefined, "a second remove has no packet");
  assert.equal(field.setWalking(id, true), undefined, "and an absent NPC cannot be toggled");
  assert.equal(field.npcs.length, 1, "the entry stays, so the id is never handed out again");
});

test("--npc-walk is a policy: nobody, everybody, or a list of template ids", () => {
  assert.equal(npcWalkPolicy(undefined)(1012000), false, "absent means no legacy requests");
  assert.equal(npcWalkPolicy("none")(1012000), false);
  assert.equal(npcWalkPolicy(" ALL ")(1012000), true, "case and spaces are not a policy");
  const some = npcWalkPolicy("2003, 1012000");
  assert.equal(some(2003), true);
  assert.equal(some(1012000), true);
  assert.equal(some(1010100), false);
  assert.throws(() => npcWalkPolicy("everyone"), /neither none, all, nor a template id/);
  assert.throws(() => npcWalkPolicy("2003,-1"), /neither none, all, nor a template id/);
});

test("legacy NPC policy is a request, not a controller flag broadcast to every joiner", () => {
  const field=new NpcField({spawns:[heena,{...heena,templateId:1010100,x:100,y:200}],walk:npcWalkPolicy("1012000")});
  assert.deepEqual(field.spawnPackets().map(packet=>packet[0]),[NPC_OPCODE.enterField,NPC_OPCODE.enterField]);
  assert.equal(field.walking,1);assert.equal(field.npcs[0]!.walking,true);assert.equal(field.npcs[1]!.walking,false);
  assert.deepEqual(field.enterPackets().map(packet=>packet[0]),[NPC_OPCODE.enterField,NPC_OPCODE.enterField]);
  field.spawnAll();assert.equal(field.npcs.length,2,"spawns are idempotent");
  field.remove(1);assert.equal(field.walking,0);
});

test("the NPC image path is the client's own format, padded to seven digits", () => {
  assert.equal(npcImagePath(2003), "Npc/0002003.img");
  assert.equal(npcImagePath(1012000), "Npc/1012000.img");
  assert.throws(() => npcImagePath(-1), /non-negative integer/);
  assert.throws(() => npcImagePath(1.5), /non-negative integer/);
});
