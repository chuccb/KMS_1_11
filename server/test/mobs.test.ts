/**
 * The field's monsters: foothold ground, the patrol, and the `0x33` (mob move) packet.
 *
 * The geometry half runs on hand-built trees so the rules are pinned independently of `Data.wz`;
 * the archive half checks the same rules against the shipped map files, including the one claim the
 * whole model rests on: every `life` entry stands on the foothold its `fh` names.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { WzNode, type WzEntry } from "../src/wz/img.ts";
import {
  WzArchive,
  footholdChain,
  footholdRange,
  footholdSegmentAt,
  footholdSegments,
  footholdYAt,
  type WzObject,
} from "../src/wz/archive.ts";
import { loadMapData, mapDataFrom, type MapData, type MapSummary } from "../src/game/map.ts";
import {
  MOB_RESPAWN_MS,
  MobField,
  mobTemplateProvider,
  PATROL_SPEED_PX_PER_SEC,
  type MobTemplate,
} from "../src/game/mobs.ts";
import { PacketReader, PacketUnderflowError } from "../src/protocol/packet.ts";
import {
  MOB_ACTION,
  MOB_ACTION_KEEP,
  MOB_ACTION_NAMES,
  MOB_OPCODE,
  describeMobMove,
  encodeMobEnterField,
  encodeMobMove,
  mobActionByte,
  mobActionName,
  readMobLeaveDelayed,
  readMobMove,
  readMobPresence,
  readMobStat,
} from "../src/protocol/mob.ts";
import { describeFieldPacket } from "../src/protocol/field.ts";

const DATA_WZ = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const archive: WzArchive | null = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : null;
const needsArchive = { skip: archive === null };

// ---------------------------------------------------------------------------
// hand-built WZ trees
// ---------------------------------------------------------------------------
const num = (name: string, value: number): WzEntry => ({ name, type: 2, value });
const obj = (name: string, props: WzEntry[]): WzEntry => ({ name, type: 9, value: new WzNode("props", props) });

/** `foothold/1/0/<id>` with the five fields a foothold item carries. */
function segment(id: string, x1: number, y1: number, x2: number, y2: number, prev: number, next: number): WzEntry {
  return obj(id, [num("x1", x1), num("y1", y1), num("x2", x2), num("y2", y2), num("prev", prev), num("next", next)]);
}

/** `foothold / <page 1> / <group 0> / segments`, the shape `footprintSegments` expects. */
function mapRoot(segments: WzEntry[]): WzObject {
  return {
    cls: "Property",
    props: [obj("foothold", [obj("1", [obj("0", segments)])])],
    offset: 0,
    end: 0,
  } as unknown as WzObject;
}

/** One flat foothold from x = 0 to x = 300 at y = 100, split into three segments. */
const FLAT = mapRoot([
  segment("1", 0, 100, 100, 100, 0, 2),
  segment("2", 100, 100, 200, 100, 1, 3),
  segment("3", 200, 100, 300, 100, 2, 0),
]);

test("a foothold item is keyed by its own id and chained by prev/next", () => {
  const segments = footholdSegments(FLAT);
  assert.deepEqual([...segments.keys()], [1, 2, 3]);
  assert.deepEqual(segments.get(2), { id: 2, layer: 1, group: 0, x1: 100, y1: 100, x2: 200, y2: 100, prev: 1, next: 3 });

  const chain = footholdChain(segments, 2);
  assert.deepEqual(chain.map((s) => s.id), [1, 2, 3], "the chain is the polyline, not tree order");
  assert.deepEqual(footholdChain(segments, 1).map((s) => s.id), [1, 2, 3], "any segment finds the whole chain");
  assert.deepEqual(footholdRange(chain), { x0: 0, x1: 300 });
  assert.equal(footholdSegmentAt(chain, 150)?.id, 2);
  assert.equal(footholdYAt(chain, 150), 100);
  assert.equal(footholdSegmentAt(chain, 301), undefined, "outside the foothold is not a guess");
  assert.equal(footholdYAt(chain, -1), undefined);
  assert.deepEqual(footholdChain(segments, 99), [], "an id the map does not have has no chain");
  assert.deepEqual(footholdSegments(undefined).size, 0);
  assert.equal(footholdSegmentAt([], 0), undefined);
  assert.equal(footholdRange([]), undefined);
});

test("y is interpolated along the segment that covers x", () => {
  const slope = footholdSegments(mapRoot([segment("7", 0, 0, 100, 50, 0, 0)]));
  const chain = footholdChain(slope, 7);
  assert.equal(footholdYAt(chain, 0), 0);
  assert.equal(footholdYAt(chain, 50), 25);
  assert.equal(footholdYAt(chain, 100), 50);
});

// ---------------------------------------------------------------------------
// the field
// ---------------------------------------------------------------------------
/** A map with mob spawns on `FLAT`, so the patrol rules can be checked without an archive. */
function flatMap(spawns: { x: number; y: number; foothold: number; rx0: number; rx1: number; facing?: number }[]): MapData {
  const summary: MapSummary = {
    info: {},
    foothold: 3,
    ladderRope: 0,
    portal: [],
    life: spawns.map((spawn) => ({
      type: "m",
      id: "0120100",
      x: spawn.x,
      y: spawn.y,
      fh: spawn.foothold,
      f: spawn.facing ?? 0,
      rx0: spawn.rx0,
      rx1: spawn.rx1,
      cy: spawn.y,
    })),
  };
  const map = mapDataFrom(summary, 1);
  map.footholdSegments = footholdSegments(FLAT);
  return map;
}

const TEMPLATES = new Map<number, MobTemplate>([
  // The stub is deliberately not a real mob: HP 20 and a 720 ms die animation are easy to reason
  // about, and 0 MP is what most 2003 mobs actually have.
  [120100, { templateId: 120100, name: "스포아", level: 2, maxHP: 20, maxMP: 0, exp: 5, speedPercent: 100, dieMs: 720 }],
  [1210100, { templateId: 1210100, name: "주황버섯", level: 8, maxHP: 75, maxMP: 200, exp: 15, speedPercent: 100, dieMs: 540 }],
]);
const provider = (id: number): MobTemplate | undefined => TEMPLATES.get(id);

test("a mob spawns where the map's foothold is, and 0x2F says so", () => {
  const map = flatMap([{ x: 150, y: 999, foothold: 2, rx0: -50, rx1: 250 }]);
  const field = new MobField({ map, footholds: map.footholdSegments!, template: provider });
  const packets = field.spawnPackets();
  assert.equal(packets.length, 1);
  const reader = new PacketReader(packets[0]!, 1);
  assert.equal(packets[0]![0], MOB_OPCODE.enterField);
  assert.equal(reader.readU32(), 1, "the field hands out its own pool ids, from 1");
  assert.equal(reader.readU32(), 120100);
  assert.equal((reader.readU16() << 16) >> 16, 150);
  assert.equal((reader.readU16() << 16) >> 16, 100, "y is the foothold's, not the spawn's own 999");
  assert.equal(field.walking, 1);
});

test("a mob walks one leg per 0x33, at its speed, and turns around at the range end", () => {
  const map = flatMap([{ x: 150, y: 100, foothold: 2, rx0: 0, rx1: 300 }]);
  const field = new MobField({
    map,
    footholds: map.footholdSegments!,
    template: provider,
    speedPxPerSecond: 100,
    maxLegMs: 1000,
  });
  const legs: { mobId: number; body: ReturnType<typeof readMobMove>["body"] }[] = [];
  let now = 0;
  for (let i = 0; i < 8; i++) {
    now += 1000;
    for (const packet of field.movePackets(now)) legs.push(readMobMove(new PacketReader(packet, 1)));
  }
  assert.equal(legs.length, 8, "one leg per tick, starting with the tick after the spawn");
  assert.deepEqual(
    legs.map((leg) => [leg.body.path.elements.at(-1)!.x, leg.body.path.elements.reduce((sum, e) => sum + e.duration, 0)]),
    [[250, 1000], [300, 500], [200, 1000], [100, 1000], [0, 1000], [100, 1000], [200, 1000], [300, 1000]],
    "100 px/s; the leg that reaches the end turns the mob around on the next one",
  );
  for (const leg of legs) {
    assert.equal(leg.body.path.elements[0]!.y, 100, "always on the ground");
    assert.ok((leg.body.path.elements[0]!.x ?? -1) >= 0 && leg.body.path.elements[0]!.x <= 300, "inside the range");
  }
  assert.equal(mobActionName(legs[0]!.body.actionByte), "move");
  assert.equal(legs[0]!.body.actionByte & 1, 0, "walking right");
  assert.equal(legs[1]!.body.actionByte & 1, 0, "still walking right at the end of the range");
  assert.equal(legs[2]!.body.actionByte & 1, 1, "and left on the way back");
  assert.equal(legs[0]!.body.path.elements.at(-1)!.foothold, 3, "the foothold the leg ends on");
  assert.equal(legs[0]!.body.value, 0, "nothing reads the u32 for a walking mob");
  assert.equal(legs[0]!.body.path.elements[0]!.vx, 0, "an element is a position snapshot (sub_495880)");
  assert.equal(legs[0]!.body.path.originX, 150, "the leg starts where the mob was");
  assert.equal(field.movePackets(1000).length, 0, "a leg is handed out once, not every tick");
  assert.equal(field.movePackets(8000).length, 0, "and not again before its duration is up");
  assert.equal(field.movePackets(9000).length, 1);
});

test("the walk range is the foothold chain clipped by the spawn's own rx0/rx1", () => {
  const map = flatMap([{ x: 150, y: 100, foothold: 2, rx0: 40, rx1: 260 }]);
  const field = new MobField({ map, footholds: map.footholdSegments!, template: provider, speedPxPerSecond: 1000 });
  const mob = field.mobs[0]!;
  assert.deepEqual(mob.range, { x0: 40, x1: 260 });
  const leg = readMobMove(new PacketReader(field.movePackets(0)[0]!, 1));
  assert.equal(leg.body.path.elements.at(-1)!.x, 260, "the map's range end, not the chain's 300");
  assert.equal(leg.body.path.elements.reduce((sum, e) => sum + e.duration, 0), 110, "110 px at 1000 px/s");
});

test("a spawn with no foothold, or a mob that cannot walk, sends nothing", () => {
  const map = flatMap([{ x: 150, y: 100, foothold: 99, rx0: 0, rx1: 300 }]);
  const noGround = new MobField({ map, footholds: map.footholdSegments!, template: provider });
  assert.equal(noGround.walking, 0);
  assert.equal(noGround.movePackets(999_999).length, 0);

  const onGround = flatMap([{ x: 150, y: 100, foothold: 2, rx0: 0, rx1: 300 }]);
  const frozen = new MobField({
    map: onGround,
    footholds: onGround.footholdSegments!,
    template: () => ({ templateId: 120100, name: "frozen", level: 1, maxHP: 1, maxMP: 0, exp: 1, speedPercent: 0, dieMs: 0 }),
  });
  assert.equal(frozen.walking, 0, "speedPercent 0 means the mob never moves");
  assert.equal(frozen.movePackets(999_999).length, 0);

  const point = new MobField({
    map: flatMap([{ x: 150, y: 100, foothold: 2, rx0: 150, rx1: 150 }]),
    footholds: onGround.footholdSegments!,
    template: provider,
  });
  assert.equal(point.walking, 0, "a range of one point is not a walk");
});

test("mobs do not all start walking in the same tick", () => {
  const map = flatMap(
    [0, 1, 2, 3].map((i) => ({ x: 50 + i * 40, y: 100, foothold: 1, rx0: 0, rx1: 300 })),
  );
  const field = new MobField({ map, footholds: map.footholdSegments!, template: provider });
  assert.equal(field.mobs.length, 4);
  assert.equal(field.movePackets(0).length, 1, "the spawn burst is spread out in time");
  assert.equal(field.movePackets(250).length, 1);
  assert.equal(field.movePackets(749).length, 1);
  assert.equal(field.movePackets(750).length, 1);
  assert.equal(field.movePackets(10000).length, 4, "and they all catch up later");
});

// ---------------------------------------------------------------------------
// the 0x33 packet
// ---------------------------------------------------------------------------
test("0x33 is mobId + action byte + u32 + CMovePath, in that order", () => {
  const packet = encodeMobMove(0x01020304, {
    actionByte: mobActionByte(MOB_ACTION.move, 1),
    value: 0,
    path: {
      originX: 509,
      originY: 335,
      elements: [{ attr: 0, x: 635, y: 275, vx: 0, vy: 0, action: mobActionByte(0, 0), foothold: 41, duration: 3000 }],
    },
  });
  assert.equal(packet[0], 0x33, "opcode byte first, like the other encoders");
  assert.deepEqual([...packet.subarray(1, 5)], [0x04, 0x03, 0x02, 0x01], "mobId, little endian");
  assert.equal(packet[5], mobActionByte(MOB_ACTION.move, 1), "action byte: action << 1 | facing");
  assert.equal(packet[5], 0x01, "move (0) facing left (1)");
  const value = packet[6]! + packet[7]! * 0x100 + packet[8]! * 0x10000 + packet[9]! * 0x1000000;
  assert.equal(value, 0, "the u32 is always there, zero for a walk");
  assert.equal(packet[10] | (packet[11] << 8), 509, "originX");
  assert.equal(packet[12] | (packet[13] << 8), 335, "originY");
  assert.equal(packet[14], 1, "one element");
  assert.equal(packet.length, 15 + 14, "opcode + u32 + u8 + u32 + u16*2 + u8 + a 14-byte element");
  const back = readMobMove(new PacketReader(packet, 1));
  assert.equal(back.mobId, 0x01020304);
  assert.deepEqual(back.body.path.elements[0], {
    attr: 0, x: 635, y: 275, vx: 0, vy: 0, action: 0, foothold: 41, duration: 3000,
  });
});

test("0x33 with negative coordinates and the keep-animation bit survives a round trip", () => {
  const packet = encodeMobMove(7, {
    actionByte: MOB_ACTION_KEEP | 0x01,
    value: 0xdeadbeef,
    path: { originX: -289, originY: 395, elements: [] },
  });
  const back = readMobMove(new PacketReader(packet, 1));
  assert.equal(back.body.actionByte, MOB_ACTION_KEEP | 0x01);
  assert.equal(back.body.value, 0xdeadbeef);
  assert.equal(back.body.path.originX, -289, "signed");
  assert.deepEqual(back.body.path.elements, [], "a mob can be told to keep its animation and not move");
  assert.equal(describeMobMove(7, back.body), "mobId=7 action=keep(0) facing=1 legs=0 no path");
});

test("a truncated 0x33 throws instead of inventing a path", () => {
  const packet = encodeMobMove(1, {
    actionByte: 0,
    value: 0,
    path: {
      originX: 0,
      originY: 0,
      elements: [{ attr: 0, x: 1, y: 2, vx: 0, vy: 0, action: 0, foothold: 1, duration: 100 }],
    },
  });
  for (let cut = 1; cut <= 14; cut++) {
    const short = packet.slice(0, packet.length - cut);
    assert.throws(() => readMobMove(new PacketReader(short, 1)), PacketUnderflowError, `${short.length} bytes`);
  }
  assert.match(describeFieldPacket(packet) ?? "", /action=move/);
  assert.match(describeFieldPacket(packet.slice(0, 10)) ?? "", /truncated/);
});

test("the mob action table is the client's own list, 16 entries wide", () => {
  assert.equal(MOB_ACTION_NAMES.length, 16);
  assert.equal(MOB_ACTION_NAMES[0], "move");
  assert.equal(MOB_ACTION_NAMES[13], "die1");
  assert.equal(MOB_ACTION.dieF, 15);
  assert.equal(mobActionName(mobActionByte(13, 1)), "die1");
  assert.equal(mobActionName(MOB_ACTION_KEEP | mobActionByte(13, 1)), undefined, "bit 7 says keep");
  assert.equal(mobActionByte(MOB_ACTION.hit1, 1) & 1, 1);
  assert.equal(mobActionByte(MOB_ACTION.attack2, 0) >> 1, 11);
});

// ---------------------------------------------------------------------------
// against Data.wz
// ---------------------------------------------------------------------------
test("every spawn of a real map stands on the foothold its life entry names", needsArchive, () => {
  for (const mapId of [1000000, 40000]) {
    const map = loadMapData(archive!, mapId) as MapData;
    const segments = map.footholdSegments;
    assert.notEqual(segments, undefined);
    assert.equal(segments!.size, map.footholds, "one segment per counted foothold");
    for (const spawn of [...map.mobs, ...map.npcs]) {
      const chain = footholdChain(segments!, spawn.foothold);
      assert.ok(chain.length > 0, `map ${mapId}: lost foothold ${spawn.foothold}`);
      const y = footholdYAt(chain, spawn.x);
      assert.notEqual(y, undefined, `map ${mapId}: foothold ${spawn.foothold} does not reach x=${spawn.x}`);
      assert.ok(Math.abs((y as number) - spawn.cy) <= 1, `map ${mapId}: y ${y} vs cy ${spawn.cy}`);
    }
  }
});

test("the default map's mobs have real templates and all of them walk", needsArchive, () => {
  const map = loadMapData(archive!, 1000000) as MapData;
  const field = new MobField({ map, footholds: map.footholdSegments!, template: mobTemplateProvider(archive!) });
  assert.equal(field.mobs.length, 45);
  assert.equal(field.walking, 45, "every spawn of this map is on a foothold and has a speed");
  assert.equal(field.mobs.some((mob) => mob.template === undefined), false, "every template id resolved");
  assert.equal(field.mobs[0]?.template?.maxHP, 20, "스포아 has 20 HP (Mob/0120100.img -> info.maxHP)");
  assert.equal(field.mobs[0]?.template?.speedPercent, 70, "info.speed -30 is 70% (sub_48D080)");

  const leg = readMobMove(new PacketReader(field.movePackets(0)[0]!, 1));
  const element = leg.body.path.elements[0]!;
  assert.ok(element.duration > 0 && element.duration <= 3000, `leg duration ${element.duration}`);
  assert.ok(element.x > 0, "the first leg walks away from the spawn");
  const chain = footholdChain(map.footholdSegments!, element.foothold);
  assert.equal(element.y, footholdYAt(chain, element.x), "and it ends on the ground it names");
});

test("the patrol speed scales with the mob's own info.speed", needsArchive, () => {
  const templates = mobTemplateProvider(archive!);
  assert.equal(templates(120100)?.speedPercent, 70, "스포아: -30");
  assert.equal(templates(130100)?.speedPercent, 30, "스텀프: -70");
  assert.equal(templates(1210102)?.speedPercent, 100, "주황버섯: 0");
  assert.equal(templates(2230100)?.speedPercent, 90, "이블아이: -10");
  assert.equal(templates(99999999), undefined, "an id Data.wz does not have is undefined, not a guess");
  assert.equal(PATROL_SPEED_PX_PER_SEC, 125, "CVecCtrl walk baseline before info.speed scaling");
});

// ---------------------------------------------------------------------------
// damage, death, corpse and respawn (FINDINGS 4.17)
// ---------------------------------------------------------------------------
/** One mob of the snapshot tests: 20 HP, 720 ms of die animation, walking a 300 px foothold. */
function hitField(): MobField {
  const map = flatMap([{ x: 150, y: 100, foothold: 2, rx0: 0, rx1: 300 }]);
  return new MobField({ map, footholds: map.footholdSegments!, template: provider, respawnMs: 1000 });
}

test("a hit takes the client's damage off the mob's HP and answers with 0x34", () => {
  const field = hitField();
  const first = field.applyDamage(1, 7, 0);
  assert.equal(first?.hp, 13, "20 - 7");
  assert.equal(first?.maxHp, 20);
  assert.equal(first?.killed, false);
  assert.equal(first?.mp, 0);
  assert.deepEqual(first?.packets.map((p) => p[0]), [MOB_OPCODE.stat], "a hit only reports the mob's stat");
  const stat = readMobStat(new PacketReader(first!.packets[0]!, 1));
  assert.deepEqual(stat, { mobId: 1, mp: 0 });
  // The damage numbers are not part of this: the attacking client drew its own (FINDINGS 4.13.1).
  assert.equal(field.mob(1)?.alive, true);
  assert.equal(field.movePackets(999).length, 1, "a hurt mob keeps walking");
});

test("0x34 carries the mob's maxMP - the value the attack picker spends", () => {
  const map = flatMap([{ x: 150, y: 100, foothold: 2, rx0: 0, rx1: 300 }]);
  const field = new MobField({
    map,
    footholds: map.footholdSegments!,
    template: () => TEMPLATES.get(1210100),
  });
  const hit = field.applyDamage(1, 1, 0);
  assert.equal(hit?.maxMp, 200);
  assert.deepEqual(readMobStat(new PacketReader(hit!.packets[0]!, 1)), { mobId: 1, mp: 200 });
});

test("the killing blow sends 0x30, stops the walking and takes no further damage", () => {
  const field = hitField();
  const hit = field.applyDamage(1, 20, 1000);
  assert.equal(hit?.killed, true);
  assert.equal(hit?.hp, 0);
  assert.equal(hit?.dieMs, 720, "the mob's die animation, from its image");
  assert.equal(hit?.respawnMs, 1000, "the field's respawn time");
  assert.deepEqual(
    hit?.packets.map((p) => p[0]),
    [MOB_OPCODE.stat, MOB_OPCODE.leaveDelayed],
    "0x34 first (the flash state the hit animation needs), then 0x30",
  );
  assert.deepEqual(readMobLeaveDelayed(new PacketReader(hit!.packets[1]!, 1)), { mobId: 1, delayMs: 0 });
  assert.equal(field.mob(1)?.alive, false);
  assert.equal(field.mobs[0]?.deaths, 1);
  assert.equal(field.applyDamage(1, 5, 1100), undefined, "a dying mob cannot be hit again");
  assert.equal(field.movePackets(9999).length, 0, "and it stops walking (its 0x33s would desync it)");
});

test("overkill clamps at 0 and a damage of 0 kills nothing", () => {
  const field = hitField();
  assert.deepEqual(
    [field.applyDamage(1, 0, 0)?.hp, field.applyDamage(1, -5, 0)?.hp],
    [20, 20],
    "a 0 or negative number is not a hit",
  );
  assert.equal(field.applyDamage(1, 9999, 0)?.hp, 0, "HP never goes below 0");
  assert.equal(field.applyDamage(1, 1, 0), undefined, "the mob is already dead");
});

test("the corpse goes when the die animation is over, and the mob comes back after it", () => {
  const field = hitField();
  const hit = field.applyDamage(1, 20, 1000)!;
  assert.equal(field.lifecyclePackets(1000).length, 0, "the animation has not run yet");
  assert.equal(field.lifecyclePackets(1000 + hit.dieMs - 1).length, 0, "not even one ms early");

  const removal = field.lifecyclePackets(1000 + hit.dieMs);
  assert.equal(removal.length, 1, "one packet: the corpse");
  assert.deepEqual(readMobPresence(new PacketReader(removal[0]!, 1)), { flag: 0, mobId: 1 });
  assert.equal(field.lifecyclePackets(1000 + hit.dieMs + 1).length, 0, "and only once");

  const respawn = field.lifecyclePackets(1000 + hit.dieMs + 1000);
  assert.equal(respawn.length, 1, "one packet: the mob is back");
  const reader = new PacketReader(respawn[0]!, 1);
  assert.equal(respawn[0]![0], MOB_OPCODE.presence, "0x31 flag=1, the form that flashes a new mob");
  assert.deepEqual(readMobPresence(reader), { flag: 1, mobId: 1 });
  assert.equal(reader.readU32(), 120100, "templateId follows the id");
  // `sub_491630` hands the rest of the packet straight to `CMob::Init`, so it *is* the 0x2F body.
  const tail = encodeMobEnterField({ mobId: 1, templateId: 120100, x: 150, y: 100, facing: 0 }).slice(9);
  assert.deepEqual([...respawn[0]!.slice(10)], [...tail], "the 0x2F body, byte for byte");
  assert.deepEqual([field.mob(1)?.hp, field.mob(1)?.alive], [20, true]);
  assert.equal(field.movePackets(1000 + hit.dieMs + 1001).length, 1, "and walks again");
});

test("tickPackets is the walking and the life cycle in one call, in that order", () => {
  const map = flatMap([
    { x: 150, y: 100, foothold: 2, rx0: 0, rx1: 300 },
    { x: 60, y: 100, foothold: 2, rx0: 0, rx1: 300 },
  ]);
  const field = new MobField({ map, footholds: map.footholdSegments!, template: provider, respawnMs: 1000 });
  assert.deepEqual(field.tickPackets(0).map((p) => p[0]), [MOB_OPCODE.move], "one leg is due");
  field.applyDamage(2, 20, 300);
  // The survivor's leg lasts 2500 ms (150 px of the stub map at 100%), so by 2600 it wants another
  // one - and the other mob's corpse (killed at 300, 720 ms of die animation) is due as well.
  const at2600 = field.tickPackets(2600);
  assert.equal(at2600[0]![0], MOB_OPCODE.move, "the legs come first");
  assert.deepEqual(
    at2600.slice(1).map((packet) => readMobPresence(new PacketReader(packet, 1))),
    [{ flag: 0, mobId: 2 }, { flag: 1, mobId: 2 }],
    "then the corpse and, in the same tick, its respawn",
  );
});

test("a mob whose Mob/<id>.img is missing cannot be hurt and does not die", () => {
  const map = flatMap([{ x: 150, y: 100, foothold: 2, rx0: 0, rx1: 300 }]);
  const field = new MobField({ map, footholds: map.footholdSegments!, template: () => undefined });
  assert.equal(field.mob(1)?.maxHp, undefined);
  assert.equal(field.applyDamage(1, 9999, 0), undefined, "no image means no HP to take");
  assert.equal(field.lifecyclePackets(1e9).length, 0, "and nothing to remove");
  assert.equal(field.mob(1)?.alive, true);
});

test("a hit on an id the field does not have is not a mob", () => {
  const field = hitField();
  assert.equal(field.applyDamage(2, 5, 0), undefined);
  assert.equal(field.mob(2), undefined);
});

test("the die animation and 0x34's value come out of the mob's own image", needsArchive, () => {
  const templates = mobTemplateProvider(archive!);
  assert.equal(templates(120100)?.dieMs, 720, "스포아: die1 is 4 frames of 180 ms (no delay property)");
  assert.equal(templates(100100)?.dieMs, 1620, "파란달팽이: 9 frames");
  assert.equal(templates(5130100)?.dieMs, 1440, "와일드보어: 8 frames");
  assert.equal(templates(5130100)?.maxMP, 200, "info.maxMP is what 0x34 reports");
  assert.equal(templates(120100)?.maxMP, 0, "most 2003 mobs have no MP at all");
  assert.equal(MOB_RESPAWN_MS, 5000, "the default respawn this server picks");

  // The whole loop on the real map: kill the first mushroom and follow it through.
  const map = loadMapData(archive!, 1000000) as MapData;
  const field = new MobField({ map, footholds: map.footholdSegments!, template: templates });
  const target = field.mobs[0]!;
  const hit = field.applyDamage(target.mobId, target.maxHp!, 0)!;
  assert.equal(hit.killed, true);
  assert.equal(hit.dieMs, 720);
  assert.deepEqual(
    field.lifecyclePackets(720).map((p) => p[0]),
    [MOB_OPCODE.presence],
    "0x31 flag=0 once the 720 ms of die1 are over",
  );
  const back = field.lifecyclePackets(720 + MOB_RESPAWN_MS);
  assert.deepEqual(back.map((p) => p[0]), [MOB_OPCODE.presence], "and the same mob appears 5 s later");
  assert.equal(back[0]![1], 1, "flag=1: `sub_491630` creates it and flashes it");
});


test("ground roaming reproduces the original timer and -1/0/+1 choices, including idle", () => {
  const map = flatMap([{ x: 150, y: 100, foothold: 2, rx0: 0, rx1: 300 }]);
  const draws = [0, .5, 0, .99, 0, 0];
  const field = new MobField({ map, footholds: map.footholdSegments!, template: provider,
    behavior: "roam", random: () => draws.shift() ?? .5, speedPxPerSecond: 100 });
  const idle = readMobMove(new PacketReader(field.movePackets(0)[0]!, 1));
  assert.equal(mobActionName(idle.body.actionByte), "stand");
  assert.equal(idle.body.path.elements[0]!.duration, 990);
  assert.equal(idle.body.path.elements[0]!.x, 150);
  assert.equal(field.movePackets(989).length, 0);
  const right = readMobMove(new PacketReader(field.movePackets(990)[0]!, 1));
  assert.equal(mobActionName(right.body.actionByte), "move");
  assert.equal(right.body.path.elements.at(-1)!.x, 249);
  assert.equal(right.body.actionByte & 1, 0);
  const left = readMobMove(new PacketReader(field.movePackets(1980)[0]!, 1));
  assert.equal(left.body.path.elements.at(-1)!.x, 150);
  assert.equal(left.body.actionByte & 1, 1);
});

test("authoritative mob positions advance over the leg, never teleport to its future end", () => {
  const map = flatMap([{ x: 150, y: 100, foothold: 2, rx0: 0, rx1: 300 }]);
  const field = new MobField({ map, footholds: map.footholdSegments!, template: provider, speedPxPerSecond: 100, maxLegMs: 1000 });
  field.movePackets(0);
  assert.equal(field.mob(1)!.x, 150);
  assert.equal(field.movePackets(500).length, 0);
  assert.equal(field.mob(1)!.x, 200);
  assert.equal(field.mob(1)!.foothold, 2);
  field.movePackets(1000);
  assert.equal(field.mob(1)!.x, 250);
  field.movePackets(1250);
  assert.equal(field.mob(1)!.x, 275);
});

test("a roaming mob waits at its ground boundary instead of compulsively ping-ponging", () => {
  const map = flatMap([{ x: 150, y: 100, foothold: 2, rx0: 100, rx1: 160 }]);
  const field = new MobField({ map, footholds: map.footholdSegments!, template: provider,
    behavior: "roam", random: () => .99, speedPxPerSecond: 100 });
  field.movePackets(0);
  const edge = readMobMove(new PacketReader(field.movePackets(100)[0]!, 1));
  assert.equal(field.mob(1)!.x, 160);
  assert.equal(mobActionName(edge.body.actionByte), "stand");
  assert.equal(edge.body.path.elements[0]!.x, 160);
  assert.equal(edge.body.path.elements[0]!.duration, 2870);
});


test("late joins resume the remaining path rather than waiting at a future destination", () => {
  const map = flatMap([{ x: 150, y: 100, foothold: 2, rx0: 0, rx1: 300 }]);
  const field = new MobField({ map, footholds: map.footholdSegments!, template: provider, speedPxPerSecond: 100, maxLegMs: 1000 });
  field.movePackets(0); field.movePackets(750);
  const resume = readMobMove(new PacketReader(field.resumePackets()[0]!, 1));
  assert.equal(resume.body.path.originX, 225);
  assert.equal(resume.body.path.elements.at(-1)!.x, 250);
  assert.equal(resume.body.path.elements.reduce((sum, e) => sum + e.duration, 0), 250);
});


test("ground paths preserve slope junctions and speed by arc distance, not a horizontal chord", () => {
  const map = flatMap([{ x: 0, y: 100, foothold: 7, rx0: 0, rx1: 200 }]);
  map.footholdSegments = footholdSegments(mapRoot([
    segment("7", 0, 100, 100, 0, 0, 8), segment("8", 100, 0, 200, 0, 7, 0),
  ]));
  const field = new MobField({ map, footholds: map.footholdSegments, template: provider, speedPxPerSecond: 100, maxLegMs: 2000 });
  const leg = readMobMove(new PacketReader(field.movePackets(0)[0]!, 1)).body.path.elements;
  assert.deepEqual(leg.map(({ x, y, duration }) => [x, y, duration]), [[100, 0, 1414], [159, 0, 590]]);
  field.movePackets(707);
  assert.equal(field.mob(1)!.x, 50);
  assert.equal(field.mob(1)!.y, 50);
  field.movePackets(1709);
  assert.equal(field.mob(1)!.x, 129.5);
  assert.equal(field.mob(1)!.y, 0);
});


test("ground mobs never climb linked vertical walls or switch to a disconnected floor", () => {
  const map = flatMap([{ x: 50, y: 100, foothold: 1, rx0: 0, rx1: 200 }]);
  map.footholdSegments = footholdSegments(mapRoot([
    segment("1", 0, 100, 100, 100, 0, 2), segment("2", 100, 100, 100, 40, 1, 3),
    segment("3", 100, 40, 200, 40, 2, 0),
  ]));
  const field = new MobField({ map, footholds: map.footholdSegments, template: provider, speedPxPerSecond: 100 });
  assert.deepEqual(field.mob(1)!.range, { x0: 0, x1: 100 });
  const path = readMobMove(new PacketReader(field.movePackets(0)[0]!, 1)).body.path;
  assert.equal(path.elements.at(-1)!.x, 100);
  assert.ok(path.elements.every((e) => e.y === 100));
  field.movePackets(500);
  assert.equal(field.mob(1)!.x, 100); assert.equal(field.mob(1)!.y, 100);
});
