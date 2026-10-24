/**
 * The world: one field per map, shared by every player in it (ADR-012).
 *
 * These tests drive `FieldInstance`/`FieldRegistry` with **fake members** - objects that implement
 * `FieldMember` and keep what they were sent. That is the point of the interface: the world layer has
 * no socket, no cipher and no session in it, so "two players in one map" is testable without a
 * network. What the real server does on top of it (the login handoff, the cipher, the sessions) is
 * covered end to end in `serve.test.ts`.
 *
 * The packet shapes themselves are pinned in `field.test.ts`/`mob.test.ts`/`npc.test.ts`/`drop.test.ts`
 * - here the assertions are about *who* gets what, read back with the same readers the client-side
 * evidence produced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nonEquipSlot } from "../src/protocol/itemslot.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { FIELD_OPCODE, readUserEnterField, readUserMove } from "../src/protocol/field.ts";
import { MOB_OPCODE, readMobEnterField, readMobPresence } from "../src/protocol/mob.ts";
import { NPC_OPCODE, readNpcEnterField, readNpcState } from "../src/protocol/npc.ts";
import { npcWalkPolicy } from "../src/game/npcs.ts";
import { DROP_OPCODE, readDropAppear, readDropRemove } from "../src/protocol/drop.ts";
import {
  FieldInstance,
  FieldRegistry,
  type FieldMember,
  type FieldPosition,
} from "../src/game/world.ts";
import type { MapData } from "../src/game/map.ts";
import type { MobTemplate } from "../src/game/mobs.ts";

/** A player that keeps every packet the field sent it. */
class FakeMember implements FieldMember {
  readonly characterId: number;
  readonly name: string;
  readonly face: number;
  readonly avatarItems: number[];
  at: FieldPosition | undefined;
  readonly packets: Uint8Array[] = [];

  constructor(characterId: number, name: string, avatarItems: number[] = [], face = 0) {
    this.characterId = characterId;
    this.name = name;
    this.avatarItems = avatarItems;
    this.face = face;
  }

  send(packet: Uint8Array): void {
    this.packets.push(packet);
  }

  /** The opcodes it was sent, in order. */
  get opcodes(): number[] {
    return this.packets.map((packet) => packet[0]!);
  }

  of(opcode: number): Uint8Array[] {
    return this.packets.filter((packet) => packet[0] === opcode);
  }

  clear(): void {
    this.packets.length = 0;
  }
}

const STUB_TEMPLATE: MobTemplate = {
  templateId: 120100,
  name: "stub",
  level: 1,
  maxHP: 30,
  maxMP: 0,
  exp: 5,
  speedPercent: 100,
  dieMs: 40,
};

/**
 * One map with everything the world layer reacts to: two monsters (one on a foothold it can walk
 * along, one standing on nothing), one NPC, two portals - the "sp" one **second**, so a test can tell
 * "the spawn portal" from "the first portal" - and one foothold segment under the spawn portal.
 */
function stubMap(overrides: Partial<MapData> = {}): MapData {
  return {
    id: 1000000,
    imagePath: "Map/Map/001000000.img",
    name: "stub",
    streetName: "stub",
    bgm: "",
    returnMapId: 0,
    mobs: [
      { templateId: 120100, x: 509, y: 300, foothold: 32, facing: 0, rx0: 0, rx1: 1000, cy: 300 },
      { templateId: 1210100, x: -5, y: 7, foothold: 0, facing: 1, rx0: -5, rx1: -5, cy: 7 },
    ],
    npcs: [{ templateId: 2003, x: 69, y: 275, foothold: 28, facing: 0, rx0: 0, rx1: 0, cy: 275 }],
    portals: [
      { name: "pt", type: 1, x: 500, y: 250, toMapId: 0, toName: "" },
      { name: "sp", type: 0, x: 100, y: 300, toMapId: 0, toName: "" },
    ],
    footholds: 1,
    ladderRopes: 0,
    footholdSegments: new Map([
      [32, { id: 32, x1: 0, y1: 300, x2: 1000, y2: 300, prev: 0, next: 0 }],
    ]),
    ...overrides,
  };
}

function stubField(overrides: Partial<MapData> = {}): FieldInstance<FakeMember> {
  return new FieldInstance<FakeMember>({
    map: stubMap(overrides),
    mobTemplate: () => STUB_TEMPLATE,
  });
}

function stubMove(
  x: number,
  y: number,
): {
  originX: number;
  originY: number;
  elements: {
    attr: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    action: number;
    foothold: number;
    duration: number;
  }[];
} {
  return {
    originX: 0,
    originY: 0,
    elements: [{ attr: 0, x, y, vx: 0, vy: 0, action: 0, foothold: 32, duration: 60 }],
  };
}

test("the first player is sent the world: every mob, every NPC, and nobody's 0x1C", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  const beforeJoin = Date.now();
  field.join(hero);
  const afterJoin = Date.now();
  const firstMoveAt = field.mobs.mobs.map((mob) => mob.legEndsAt);
  assert.ok(
    firstMoveAt[0]! >= beforeJoin && firstMoveAt[0]! <= afterJoin,
    "the first movement deadline uses the server clock when the snapshot is sent",
  );
  assert.equal(
    firstMoveAt[1]! - firstMoveAt[0]!,
    250,
    "the second mob is still staggered by 250ms",
  );

  assert.deepEqual(hero.opcodes, [
    MOB_OPCODE.enterField,
    MOB_OPCODE.enterField,
    NPC_OPCODE.enterField,
  ]);
  const first = readMobEnterField(new PacketReader(hero.packets[0]!, 1));
  const second = readMobEnterField(new PacketReader(hero.packets[1]!, 1));
  assert.deepEqual(
    [first.mobId, first.templateId],
    [1, 120100],
    "the map's mobs, in map order, with the field's ids",
  );
  assert.deepEqual([second.mobId, second.templateId], [2, 1210100]);
  const npc = readNpcEnterField(new PacketReader(hero.packets[2]!, 1), false);
  assert.deepEqual(
    { npcId: npc.npcId, templateId: npc.templateId, x: npc.x, y: npc.y, facing: npc.facing },
    { npcId: 1, templateId: 2003, x: 69, y: 275, facing: 0 },
    "the joining player needs the *full* 0x39: their client has never seen the id",
  );
});

test("0x3B: one designated controller, not every player who joins", () => {
  const field = new FieldInstance<FakeMember>({
    map: stubMap(),
    mobTemplate: () => STUB_TEMPLATE,
    npcWalk: npcWalkPolicy("2003"),
  });
  const hero = new FakeMember(1, "Hero");
  field.join(hero);
  assert.deepEqual(hero.opcodes, [
    MOB_OPCODE.enterField,
    MOB_OPCODE.enterField,
    NPC_OPCODE.enterField,
    NPC_OPCODE.stateToggle,
  ]);
  assert.deepEqual(readNpcState(new PacketReader(hero.packets[3]!, 1)), { npcId: 1, on: true });
  assert.equal(field.npcs.walking, 1);

  // Visibility reaches both players, but only the first controls the NPC.
  const alt = new FakeMember(2, "Alt");
  field.join(alt);
  assert.deepEqual(
    alt.packets.slice(0, 3).map((packet) => packet[0]!),
    [MOB_OPCODE.enterField, MOB_OPCODE.enterField, NPC_OPCODE.enterField],
  );
  assert.equal(alt.of(NPC_OPCODE.stateToggle).length, 0);
  field.leave(hero.characterId);
  assert.deepEqual(readNpcState(new PacketReader(alt.of(NPC_OPCODE.stateToggle)[0]!, 1)), {
    npcId: 1,
    on: true,
  });
});

test("a second player and the first learn about each other with one 0x1C each - and never their own", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero", [], 20000);
  const alt = new FakeMember(2, "Alt", [30000, 1002001], 20005);
  field.join(hero);
  hero.clear();
  field.join(alt);

  const heroSaw = hero.of(FIELD_OPCODE.userEnterField);
  const altSaw = alt.of(FIELD_OPCODE.userEnterField);
  assert.equal(heroSaw.length, 1, "the player already there gets exactly one 0x1C: the newcomer's");
  assert.equal(altSaw.length, 1, "and the newcomer gets exactly one: the player already there");
  const aboutAlt = readUserEnterField(new PacketReader(heroSaw[0]!, 1));
  const aboutHero = readUserEnterField(new PacketReader(altSaw[0]!, 1));
  assert.deepEqual([aboutAlt.characterId, aboutAlt.name], [2, "Alt"]);
  assert.deepEqual([aboutHero.characterId, aboutHero.name], [1, "Hero"]);
  assert.deepEqual(
    aboutAlt.avatarItems,
    [30000, 1002001],
    "the hair and the worn items travel as the avatar list",
  );
  assert.deepEqual(aboutHero.avatarItems, []);
  assert.deepEqual(
    [aboutAlt.face, aboutHero.face],
    [20005, 20000],
    "the face each member carries goes out as the 0x1C's first u32 - it is what the client draws",
  );
  assert.equal(field.memberCount, 2);
});

test("a player who has not moved yet stands on the map's spawn portal, on its own foothold", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  field.join(hero);
  const alt = new FakeMember(2, "Alt");
  field.join(alt);

  const about = alt.of(FIELD_OPCODE.userEnterField);
  assert.equal(
    about.length,
    1,
    "the newcomer gets the snapshot first and then the 0x1C about the player there",
  );
  const aboutHero = readUserEnterField(new PacketReader(about[0]!, 1));
  assert.deepEqual(
    { x: aboutHero.x, y: aboutHero.y, foothold: aboutHero.foothold },
    { x: 500, y: 240, foothold: 32 },
    "a fresh character carries index 0, which is the FIRST non-pt3 portal (sub_4A3920), not the " +
      "one called `sp` - and the feet land 10px above it (sub_511820)",
  );
  // The index is the only thing that picks a portal. This map's `sp` is index 1 and is somewhere
  // else entirely, which is why the byte has to travel in `CharacterData` in the first place.
  assert.deepEqual(
    { x: field.spawnAt(1).x, y: field.spawnAt(1).y },
    { x: 100, y: 290 },
    "index 1 is `sp`: the same rule, a different portal",
  );
});

test("a map with no portals at all spawns at the origin - and its geometry still places the point", () => {
  const field = stubField({ portals: [] });
  assert.deepEqual(
    field.spawnAt(),
    { x: 0, y: 0, foothold: 32 },
    "no portal: the origin, on the segment that covers x = 0",
  );
});

test("a map with no geometry sends foothold 0, which the client reads as no foothold", () => {
  const field = stubField({ portals: [], footholdSegments: undefined });
  assert.deepEqual(field.spawnAt(), { x: 0, y: 0 });
  const alt = new FakeMember(2, "Alt");
  field.join(alt);
  const about = alt.of(FIELD_OPCODE.userEnterField);
  assert.deepEqual(
    about,
    [],
    "no other player, so no 0x1C at all - which is the point of the field being empty",
  );
});

test("a player who has moved is announced where they were, not at the spawn portal", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  field.join(hero);
  field.reportMove(1, stubMove(300, 290));

  const alt = new FakeMember(2, "Alt");
  field.join(alt);
  const about = alt.of(FIELD_OPCODE.userEnterField);
  assert.deepEqual(
    about.map((packet) => {
      const user = readUserEnterField(new PacketReader(packet, 1));
      return [user.characterId, user.x, user.y];
    }),
    [[1, 300, 290]],
  );
});

test("a move goes to the other players as 0x22, with the id the sender's own 0x0E does not carry", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  const alt = new FakeMember(2, "Alt");
  field.join(hero);
  field.join(alt);
  hero.clear();
  alt.clear();

  field.reportMove(1, stubMove(300, 290));

  assert.deepEqual(
    hero.opcodes,
    [],
    "the mover's own client knows what it did - nothing comes back",
  );
  assert.deepEqual(alt.opcodes, [FIELD_OPCODE.userMove]);
  const move = readUserMove(new PacketReader(alt.packets[0]!, 1));
  assert.equal(move.characterId, 1);
  assert.deepEqual(
    move.path.elements.map((element) => [element.x, element.y]),
    [[300, 290]],
  );
  assert.equal(field.member(1)?.at?.x, 300, "and the field remembers it");
});

test("a move from a character this field does not have is dropped, not relayed", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  field.join(hero);
  hero.clear();
  field.reportMove(99, stubMove(1, 2));
  assert.deepEqual(hero.opcodes, []);
});

test("leaving tells the others with 0x1D, and leaving twice tells nobody anything", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  const alt = new FakeMember(2, "Alt");
  field.join(hero);
  field.join(alt);
  hero.clear();
  alt.clear();

  field.leave(2);
  assert.deepEqual(alt.opcodes, [], "the one who left is not told about their own departure");
  assert.deepEqual(hero.opcodes, [FIELD_OPCODE.userLeaveField]);
  assert.equal(
    new PacketReader(hero.packets[0]!, 1).readU32(),
    2,
    "the id of the character that left",
  );
  assert.equal(field.memberCount, 1);

  hero.clear();
  field.leave(2);
  assert.deepEqual(hero.opcodes, [], "a second leave is not an event");
});

test("the same character id twice replaces the first, with an 0x1D in between", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  const alt = new FakeMember(2, "Alt");
  field.join(hero);
  field.join(alt);
  alt.clear();

  const again = new FakeMember(1, "HeroAgain");
  field.join(again);

  assert.deepEqual(
    alt.opcodes,
    [FIELD_OPCODE.userLeaveField, FIELD_OPCODE.userEnterField],
    "one id cannot be in a field twice",
  );
  const about = readUserEnterField(new PacketReader(alt.packets[1]!, 1));
  assert.equal(about.name, "HeroAgain");
  assert.equal(field.member(1), again);
  assert.equal(field.memberCount, 2);
});

test("one hit on a monster is one set of packets, whatever the number of witnesses", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  const alt = new FakeMember(2, "Alt");
  field.join(hero);
  field.join(alt);
  hero.clear();
  alt.clear();

  const now = Date.now();
  const hit = field.mobs.applyDamage(1, 5, now);
  assert.ok(hit !== undefined);
  field.broadcastAll(hit.packets);

  assert.deepEqual(hero.opcodes, alt.opcodes, "the same packets, in the same order, to everyone");
  assert.deepEqual(
    hero.opcodes,
    [MOB_OPCODE.stat],
    "a hit that does not kill reports the monster's MP",
  );
  assert.equal(hit.hp, 25, "and the HP is the field's, so the next hit starts from 25");
});

test("a killed monster leaves the field's map, for every player at once", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  const alt = new FakeMember(2, "Alt");
  field.join(hero);
  field.join(alt);
  hero.clear();
  alt.clear();

  const now = Date.now();
  const hit = field.mobs.applyDamage(1, 999, now);
  assert.ok(hit !== undefined && hit.killed);
  field.broadcastAll(hit.packets);
  assert.deepEqual(hero.opcodes, [MOB_OPCODE.stat, MOB_OPCODE.leaveDelayed]);
  assert.deepEqual(alt.opcodes, hero.opcodes);
});

test("a corpse goes and a monster comes back even with nobody in the map", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  field.join(hero);
  hero.clear();

  const now = Date.now();
  const hit = field.mobs.applyDamage(1, 999, now);
  assert.ok(hit !== undefined);
  field.tick(now + hit.dieMs + 1);
  assert.deepEqual(hero.opcodes, [MOB_OPCODE.presence], "the corpse goes as 0x31 flag 0");
  assert.equal(readMobPresence(new PacketReader(hero.packets[0]!, 1)).flag, 0);

  field.leave(1);
  hero.clear();
  field.tick(now + hit.dieMs + hit.respawnMs + 1);
  assert.deepEqual(hero.opcodes, [], "nobody is there to see it, but the field ticked");
  assert.equal(field.mobs.mob(1)?.alive, true, "the monster is back in the map");

  const late = new FakeMember(3, "Late");
  field.join(late);
  assert.deepEqual(late.opcodes, [
    MOB_OPCODE.enterField,
    MOB_OPCODE.enterField,
    NPC_OPCODE.enterField,
  ]);
});

test("the monsters walk only while somebody is watching, and everyone sees the same leg", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  field.join(hero);
  hero.clear();

  const now = Date.now();
  field.tick(now);
  assert.equal(
    hero.of(MOB_OPCODE.move).length,
    1,
    "the mob on the foothold gets one leg; the other cannot walk",
  );
  const alt = new FakeMember(2, "Alt");
  field.join(alt);
  hero.clear();
  alt.clear();

  field.tick(now + 10_000);
  const heroLegs = hero.of(MOB_OPCODE.move);
  const altLegs = alt.of(MOB_OPCODE.move);
  assert.equal(heroLegs.length, 1);
  assert.deepEqual(
    altLegs.map((packet) => [...packet]),
    heroLegs.map((packet) => [...packet]),
    "one plan, two clients",
  );

  field.leave(1);
  field.leave(2);
  hero.clear();
  field.tick(now + 20_000);
  assert.deepEqual(
    hero.opcodes,
    [],
    "a leg is a promise to a client; with nobody there the mob stands still",
  );
});

test("loot on the ground expires for everyone, and a late joiner is shown it first", () => {
  const field = new FieldInstance<FakeMember>({
    map: stubMap(),
    mobTemplate: () => STUB_TEMPLATE,
    // Exercise the shipped policy deterministically: the first `range(0, 1000)` is a meso hit.
    dropRandom: {
      next: () => 0,
      range: (lo, span) => (span === 0 ? 0 : lo),
    },
  });
  const hero = new FakeMember(1, "Hero");
  field.join(hero);

  const now = Date.now();
  const spawned = field.drops.spawnFromDeath(
    { mobId: 1, templateId: 120100, name: "stub", level: 1, x: 509, y: 300, foothold: 32 },
    now,
  );
  assert.ok(spawned.length > 0, "the shipped drop table leaves something");
  const drop = spawned[0]!;

  const alt = new FakeMember(2, "Alt");
  field.join(alt);
  const appear = alt.of(DROP_OPCODE.appear);
  assert.equal(
    appear.length,
    spawned.length,
    "the joiner is sent every drop already on the ground",
  );
  assert.equal(readDropAppear(new PacketReader(appear[0]!, 1)).dropId, drop.dropId);

  hero.clear();
  alt.clear();
  field.tick(now + 10 * 60 * 1000);
  const reminders = hero.of(DROP_OPCODE.remove);
  assert.equal(
    reminders.length,
    spawned.length,
    "every drop of that kill is past DROP_LIFETIME_MS",
  );
  assert.deepEqual(alt.of(DROP_OPCODE.remove).length, spawned.length, "and both players are told");
  const removed = reminders.map((packet) => readDropRemove(new PacketReader(packet, 1)));
  for (const one of removed) {
    assert.equal(one.kind, 0, "kind 0 is 'it expired', not 'somebody took it'");
    assert.equal(one.characterId, undefined, "no character id: nobody took it");
  }
  assert.deepEqual(
    removed.map((one) => one.dropId).sort(),
    spawned.map((drop) => drop.dropId).sort(),
    "the drops that went are exactly the ones that were there",
  );
  assert.equal(field.drops.drops.length, 0);
});

test("a drop one player picks up is off the ground for the others, with the taker's id", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  const alt = new FakeMember(2, "Alt");
  field.join(hero);
  field.join(alt);
  hero.clear();
  alt.clear();

  field.broadcastDropTaken(7, 2);
  for (const member of [hero, alt]) {
    assert.deepEqual(member.opcodes, [DROP_OPCODE.remove]);
    assert.deepEqual(readDropRemove(new PacketReader(member.packets[0]!, 1)), {
      kind: 2,
      dropId: 7,
      characterId: 2,
    });
  }
});

test("a broadcast can skip one player, which is how a level-up effect would be sent", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero");
  const alt = new FakeMember(2, "Alt");
  field.join(hero);
  field.join(alt);
  hero.clear();
  alt.clear();

  field.broadcast(new Uint8Array([0x29]), 2);
  assert.deepEqual(hero.opcodes, [0x29]);
  assert.deepEqual(alt.opcodes, []);
  field.broadcastAll([new Uint8Array([1]), new Uint8Array([2])]);
  assert.deepEqual(hero.opcodes, [0x29, 1, 2]);
});

test("the registry hands the same field to every player of a map, and keeps it", () => {
  const registry = new FieldRegistry<FakeMember>({
    mapProvider: (mapId: number) => (mapId === 1000000 ? stubMap() : undefined),
    mobTemplate: () => STUB_TEMPLATE,
  });
  assert.equal(registry.of(2000000), undefined, "a map with no Map/Map/*.img has no field");
  assert.equal(registry.size, 0, "and asking does not create one");

  const field = registry.of(1000000);
  assert.ok(field !== undefined);
  assert.equal(registry.of(1000000), field, "the same map id is the same field");
  assert.equal(registry.size, 1);

  const hero = new FakeMember(1, "Hero");
  const alt = new FakeMember(2, "Alt");
  field.join(hero);
  field.join(alt);
  const now = Date.now();
  const hit = field.mobs.applyDamage(1, 999, now);
  assert.ok(hit !== undefined);
  hero.clear();
  alt.clear();
  field.leave(1);
  field.leave(2);

  const later = new FakeMember(3, "Later");
  field.join(later);
  assert.equal(registry.of(1000000), field, "the world outlives the connections in it");
  assert.equal(field.mobs.mob(1)?.alive, false, "including a monster somebody killed");
  assert.deepEqual(
    later.opcodes,
    [MOB_OPCODE.enterField, NPC_OPCODE.enterField],
    "so a late joiner is sent the one monster that is still alive, plus the NPC",
  );
});

test("a portal is found by the name the client sends, and knows where it leads", () => {
  const portal = { name: "west00", type: 2, x: 130, y: 300, toMapId: 2000000, toName: "east00" };
  const field = stubField({ portals: [portal] });

  assert.deepEqual(
    field.portal("west00"),
    portal,
    "the name is the `pn` the client read out of the map file",
  );
  assert.equal(
    field.portal("WEST00"),
    portal,
    "the name is data, so case must not decide whether a portal works",
  );
  assert.equal(
    field.portal("nowhere"),
    undefined,
    "a name the map does not have is not a teleport",
  );
  assert.equal(field.mapId, 1000000);
  assert.equal(
    field.map.id,
    1000000,
    "a field keeps the map it simulates - the portals and the spawn point are its questions",
  );
});

test("a second map is a second field: its own spawn point, its own mobs, and it is kept too", () => {
  const registry = new FieldRegistry<FakeMember>({
    mapProvider: (mapId: number) =>
      mapId === 2000000
        ? stubMap({
            id: 2000000,
            name: "stub-alt",
            portals: [
              { name: "east00", type: 2, x: 600, y: 300, toMapId: 1000000, toName: "west00" },
            ],
          })
        : undefined,
    mobTemplate: () => STUB_TEMPLATE,
  });

  const alt = registry.of(2000000);
  assert.ok(alt !== undefined);
  assert.equal(alt.mapId, 2000000);
  assert.deepEqual(
    alt.spawnAt(),
    { x: 600, y: 290, foothold: 32 },
    "this map's portal, this map's foothold - and the 10px above it (sub_511820)",
  );
  assert.equal(alt.portal("west00"), undefined, "the portal of the other map is not here");
  assert.equal(registry.size, 1);

  const hero = new FakeMember(1, "Hero");
  alt.join(hero);
  assert.deepEqual(hero.opcodes.slice(0, 3), [
    MOB_OPCODE.enterField,
    MOB_OPCODE.enterField,
    NPC_OPCODE.enterField,
  ]);
  assert.equal(registry.of(2000000), alt);
  assert.equal(registry.size, 1, "and asking for it again is still the same field");
});

// Latest posture regression SOURCE ONLY, not executed/typechecked for this delivery.
test("late join retains the mover's prone/rope movement byte, facing and reported foothold", () => {
  const field = stubField(),
    hero = new FakeMember(1, "Hero");
  field.join(hero);
  const prone = stubMove(300, 290);
  prone.elements[0]!.action = 11;
  prone.elements[0]!.foothold = 32;
  field.reportMove(1, prone);
  const alt = new FakeMember(2, "Alt");
  field.join(alt);
  const user = readUserEnterField(new PacketReader(alt.of(FIELD_OPCODE.userEnterField)[0]!, 1));
  assert.equal(user.action, 11);
  assert.equal(user.foothold, 32);
  assert.equal(field.member(1)?.at?.action, 11);
  const rope = stubMove(350, 240);
  rope.elements[0]!.action = 17;
  rope.elements[0]!.foothold = 65529;
  field.reportMove(1, rope);
  const third = new FakeMember(3, "Third");
  field.join(third);
  const remote = third
    .of(FIELD_OPCODE.userEnterField)
    .map((p) => readUserEnterField(new PacketReader(p, 1)))
    .find((u) => u.characterId === 1)!;
  assert.equal(remote.action, 17);
  assert.equal(remote.foothold, 65529);
});

/** Source-only regression added for ADR-077; not executed in this turn. */
test("ordered multi-record move retains terminal position/posture for combat and late join, relays all records", () => {
  const field = stubField(),
    hero = new FakeMember(1, "Hero"),
    alt = new FakeMember(2, "Alt");
  field.join(hero);
  field.join(alt);
  hero.clear();
  alt.clear();
  const path = stubMove(100, 300);
  path.elements[0]!.duration = 0;
  path.elements.push({
    ...path.elements[0]!,
    x: 300,
    y: 290,
    vx: 125,
    action: 3,
    foothold: 0,
    duration: 30,
  });
  path.elements.push({
    ...path.elements[0]!,
    x: 310,
    y: 280,
    vx: 125,
    vy: -270,
    action: 7,
    foothold: 0,
    duration: 30,
    attr: 2,
  });
  field.reportMove(1, path);
  assert.deepEqual(
    [field.member(1)?.at?.x, field.member(1)?.at?.y, field.member(1)?.at?.action],
    [310, 280, 7],
  );
  const relayed = readUserMove(new PacketReader(alt.of(FIELD_OPCODE.userMove)[0]!, 1));
  assert.deepEqual(relayed.path, path);
  assert.equal(hero.of(FIELD_OPCODE.userMove).length, 0);
  const late = new FakeMember(3, "Late");
  field.join(late);
  const enter = late
    .of(FIELD_OPCODE.userEnterField)
    .map((packet) => readUserEnterField(new PacketReader(packet, 1)))
    .find((user) => user.characterId === 1)!;
  assert.deepEqual([enter.x, enter.y, enter.foothold, enter.action], [310, 280, 0, 7]);
});

test("airborne player item/meso throws broadcast the same real FH landing to everyone and late joiners", () => {
  const field = stubField();
  const hero = new FakeMember(1, "Hero"),
    witness = new FakeMember(2, "Witness");
  field.join(hero);
  field.join(witness);
  hero.at = { x: 250, y: 100, foothold: 0 };
  hero.clear();
  witness.clear();
  const slot = nonEquipSlot(4000019, 5);
  const item = field.dropItem(hero, slot, 2, 10),
    mesos = field.dropMesos(hero, 99, 10);
  for (const entry of [item, mesos])
    assert.deepEqual([entry.x, entry.y, entry.foothold], [250, 300, 32]);
  assert.deepEqual(hero.of(DROP_OPCODE.appear), witness.of(DROP_OPCODE.appear));
  const late = new FakeMember(3, "Late");
  field.join(late);
  assert.deepEqual(late.of(DROP_OPCODE.appear), hero.of(DROP_OPCODE.appear));
  for (const packet of late.of(DROP_OPCODE.appear)) {
    const drop = readDropAppear(new PacketReader(packet, 1));
    assert.deepEqual([drop.x, drop.y, drop.kind, drop.mobId], [250, 300, 2, undefined]);
  }
  assert.equal(field.drops.reachable(250, 100, 11), undefined);
  assert.equal(field.drops.reachable(250, 300, 11)?.dropId, item.dropId);
  assert.equal(slot.quantity, 5, "field placement does not mutate caller inventory");
});
