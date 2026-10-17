/**
 * Live smoke for the whisper/find slice (FINDINGS 4.31) against `node server/src/cli.ts serve`.
 *
 * It is a 2003 client in miniature: the login chain (0x01 -> 0x02 -> 0x03), the game-server
 * handshake (0x04), and then the thing under test - `0x23` for a whisper and a find, plus the two
 * `0x1A` answers. The cipher/framing modules are imported from the repo, so this drives the real
 * server over real sockets, with the real `Data.wz` maps behind it.
 *
 *   node server/scripts/whisper_probe.mjs <loginPort> <gamePort>
 *
 * The accounts and the field maps come from the server side:
 *   node src/cli.ts serve --port 8495 --game-port 8496 --account admin:admin,alt:alt \
 *        --save /tmp/whisper-save.json --data ../Data.wz --ping off
 * It creates the two characters itself (0x06 name check + 0x05 create) when the save is empty,
 * so a fresh `--save` file is the easiest way to run it. A *second* run starts from wherever the
 * last one left the pair - Hero in 헤네시스, because the scroll section moves him there - so the
 * sections that need both of them in one map print a `..` note and are skipped, not failed. `--data` is what makes the find answer
 * carry a real map id: after both players land in 1000000 the probe walks Alt through that map's
 * "east00" portal (0x0D), so the whisper really does cross a map boundary. It ends with the revive
 * dialog's request (0x0D `kind = 0`, FINDINGS 4.32), which turns 1000000's `info/returnMap` - the real
 * 1010000 - into the map the dead player is put back into. Before that it plays the client's own half
 * of a monster's hit (c2s `0x1C`, FINDINGS 4.33: report the signed HP/MP delta, read the `0x0D` that
 * comes back) so the revive has something to refill.
 *
 * The last section uses an item (`0x18`/`0x19`): it clicks 마이 (12100) in the town the revive lands
 * in, buys 헤네시스 귀환 주문서, and then uses it - which is a map change by item (`0x0B` + `0x16`).
 * That half needs a wallet: run the server with `--start-mesos 200` and a fresh `--save` file, and
 * the section checks the purchase, the price and the map; without the mesos it prints a note and
 * skips it.
 *
 * Before the whisper, while both are still in 1000000, the two attack sections run: a swing (c2s
 * `0x0F` -> s2c `0x23`), a shot (c2s `0x10` -> s2c `0x24`) and a cast (c2s `0x11` -> s2c `0x25`), each
 * checked on the *other* player's socket and never echoed to the attacker (FINDINGS 4.11.7b/4.11.7c).
 *
 * The emotion section runs while both are still in the town the revive landed in: Hero sends the
 * `0x13` an F-key sends (`[0x13][u32 face]`), and Alt - who is standing in the same map - is the one
 * who gets the `0x27` that puts the face on Hero. Hero gets nothing back, because his own client
 * already applied it before it sent the packet (FINDINGS 4.35).
 */
import net from "node:net";
import { CipherState, CLIENT_SEND_MAGIC, SERVER_SEND_MAGIC } from "../src/protocol/cipher.ts";
import { encodeSessionPacket, SessionDeframer } from "../src/protocol/session.ts";
import { PacketReader, PacketWriter } from "../src/protocol/packet.ts";
import { readCharacterData } from "../src/protocol/chardata.ts";
import { encodeCp949 } from "../src/protocol/cp949.ts";
import { readStatUpdate } from "../src/protocol/stat.ts";
import {
  CLIENT_FIELD_OPCODE,
  encodeClientAttack,
  encodeClientChangeSlot,
  encodeClientUseItem,
  encodeClientEmotion,
  encodeClientUserMove,
  readUserAttack,
  readUserEmotion,
  readUserEnterField,
  readUserLook,
} from "../src/protocol/field.ts";
import { FIELD_OPCODE } from "../src/protocol/field.ts";
import { INVENTORY_OP, INVENTORY_OPCODE, readInventoryChange } from "../src/protocol/inventory.ts";
import {
  DROP_KIND,
  DROP_OPCODE,
  DROP_REMOVE_KIND,
  LOOT_OPCODE,
  readDropAppear,
  readDropRemove,
  readLootNotice,
} from "../src/protocol/drop.ts";
import { NPC_OPCODE, readNpcEnterField } from "../src/protocol/npc.ts";
import {
  CLIENT_OBJECT_CLICK_OPCODE,
  CLIENT_SHOP_OPCODE,
  SHOP_OPEN_OPCODE,
  SHOP_RESULT,
  SHOP_RESULT_OPCODE,
  encodeClientObjectClick,
  encodeClientShopRequest,
  readShopOpen,
} from "../src/protocol/shop.ts";

const [loginPort, gamePort] = process.argv.slice(2).map(Number);

/**
 * The ten words the create dialog sends (FINDINGS 4.8.1a), with ids that exist in the shipped
 * `Data.wz`: face 20000, hair 30000, a top (1040001), pants (1060001), shoes (1071000) and a weapon
 * (1302000), then four dice. The last four are the ones nobody can place yet, so any values do.
 */
const DIALOG_LOOK = [20000, 30000, 1040001, 1060001, 1071000, 1302000, 4, 5, 6, 7];

class Client {
  constructor(port) {
    this.queue = [];
    this.waiter = undefined;
    this.socket = net.connect(port, "127.0.0.1");
    this.deframer = new SessionDeframer({ expectedMagic: SERVER_SEND_MAGIC });
    this.sendState = new CipherState(0);
    this.socket.on("data", (chunk) => {
      for (const event of this.deframer.push(new Uint8Array(chunk))) {
        if (event.kind === "handshake") {
          this.sendState = new CipherState(event.handshake.sendSeed);
          continue;
        }
        this.queue.push(event.plain);
      }
      this.waiter?.();
    });
    this.socket.on("error", (error) => console.log(`  socket error: ${error.message}`));
  }

  static async connect(port) {
    const client = new Client(port);
    await new Promise((resolve, reject) => {
      client.socket.once("connect", resolve);
      client.socket.once("error", reject);
    });
    const deadline = Date.now() + 4000;
    while (client.deframer.awaitingHandshake) {
      if (Date.now() > deadline) throw new Error("no handshake");
      await new Promise((r) => setTimeout(r, 10));
    }
    return client;
  }

  send(body) {
    this.socket.write(encodeSessionPacket(body, this.sendState, "c2s"));
  }

  async take(opcode, timeoutMs = 5000) {
    const seen = [];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.queue.length === 0) {
        await new Promise((resolve) => {
          this.waiter = resolve;
          setTimeout(resolve, 10);
        });
        continue;
      }
      const packet = this.queue.shift();
      seen.push(packet[0]);
      if (packet[0] === opcode) return packet;
    }
    throw new Error(
      `no 0x${opcode.toString(16)} within ${timeoutMs} ms; saw [${seen.map((b) => b.toString(16)).join(",")}]`,
    );
  }

  /** Everything that arrives within `ms` - the honest way to say "and then nothing". */
  async drain(ms = 300) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return this.queue.splice(0, this.queue.length);
  }

  close() {
    this.socket.destroy();
  }
}

/** Logs in, makes sure the account has a character, and hands that character to the game server. */
async function enterGame(user, password, wanted) {
  const login = await Client.connect(loginPort);
  const loginBody = new PacketWriter(64);
  loginBody.writeByte(0x01).writeAsciiString(user).writeAsciiString(password);
  login.send(loginBody.toBytes());
  const loginReply = await login.take(0x01);
  const result = new PacketReader(loginReply, 1).readByte();
  if (result !== 0 && result !== 1 && result < 10) throw new Error(`login refused with result ${result}`);

  // The world select walks the client's stage to "char", and a second 0x02 is then ignored - so the
  // character list is read once, here, and a create afterwards comes back on its own reply.
  const worldRequest = new PacketWriter(8);
  worldRequest.writeByte(0x02).writeByte(0);
  login.send(worldRequest.toBytes());
  const worldReply = await login.take(0x02);
  const reader = new PacketReader(worldReply, 1);
  const worldResult = reader.readByte();
  if (worldResult !== 0) throw new Error(`world select refused with result ${worldResult}`);
  const count = reader.readByte();
  const list = [];
  for (let i = 0; i < count; i++) list.push(readCharacterData(reader));
  console.log(`  ${user}: ${count} character(s) [${list.map((c) => `${c.stats.name}#${c.stats.id}`).join(", ")}]`);

  if (!list.some((character) => character.stats.name === wanted)) {
    // The ten appearance words the create dialog sends (FINDINGS 4.8.1a): face, hair, top, pants,
    // shoes and weapon - all of them ids that exist in `Character/` of the shipped Data.wz - and then
    // the four dice rolls, whose STR/DEX/INT/LUK order nobody has located yet. The server has to put
    // the first two in the record and the other four in its worn group, which is the only place the
    // client reads clothes from (`sub_42E2C0`).
    const check = new PacketWriter(64);
    check.writeByte(0x06).writeAsciiString(wanted);
    for (const word of DIALOG_LOOK) check.writeU32(word);
    login.send(check.toBytes());
    const checkReply = await login.take(0x04);
    console.log(`  ${user}: name "${wanted}" check -> result ${checkReply[checkReply.length - 1]}`);

    const create = new PacketWriter(32);
    create.writeByte(0x05).writeAsciiString(wanted);
    login.send(create.toBytes());
    const createReply = await login.take(0x05);
    const flag = createReply[1];
    console.log(`  ${user}: create "${wanted}" -> flag ${flag}`);
    if (flag === 0) throw new Error(`create refused for ${user}`);
    const created = readCharacterData(new PacketReader(createReply, 2));
    expect(
      [...(created.items?.worn ?? new Map()).keys()].join(",") === "5,6,7,11",
      `the four wardrobe words came back as worn equips in slots [${[...(created.items?.worn ?? new Map()).keys()].join(",")}]`,
    );
    list.push(created);
  }

  const character = list.find((entry) => entry.stats.name === wanted) ?? list[0];
  if (character === undefined) throw new Error(`${user} has no character to play`);

  const select = new PacketWriter(8);
  select.writeByte(0x03).writeU32(character.stats.id);
  login.send(select.toBytes());
  const selectReply = await login.take(0x03);
  const selectReader = new PacketReader(selectReply, 1);
  const selectResult = selectReader.readByte();
  if (selectResult !== 0) throw new Error(`character select refused with result ${selectResult}`);
  const ipWire = selectReader.readU32();
  const ip = [ipWire & 0xff, (ipWire >>> 8) & 0xff, (ipWire >>> 16) & 0xff, ipWire >>> 24].join(".");
  const port = selectReader.readU16();
  const handoff = selectReader.readU32();
  console.log(`  ${user}: "${character.stats.name}" -> ${ip}:${port} as 0x${handoff.toString(16)}`);
  login.close();

  const game = await Client.connect(gamePort);
  const claim = new PacketWriter(8);
  claim.writeByte(0x04).writeU32(handoff);
  game.send(claim.toBytes());
  return { game, name: character.stats.name, characterId: handoff, character };
}

/** `0x16` = opcode, mode, "carries data", three seed u32s, then the full CharacterData. */
function characterOfSetField(packet) {
  return readCharacterData(new PacketReader(packet, 15));
}

function mapIdOfSetField(packet) {
  return characterOfSetField(packet).stats.mapId;
}

const failures = [];
function expect(condition, what) {
  console.log(`${condition ? "  ok  " : "  FAIL"} ${what}`);
  if (!condition) failures.push(what);
}

const hero = await enterGame("admin", "admin", "Hero");
const heroMap = mapIdOfSetField(await hero.game.take(0x16)); // the field we were put into
const alt = await enterGame("alt", "alt", "Alt");
let altMap = mapIdOfSetField(await alt.game.take(0x16));
console.log(`  ..   Hero is in map ${heroMap}, Alt in map ${altMap}`);

// --- a swing: 0x0F out, 0x23 to the rest of the map, nothing back (FINDINGS 4.11.7b) --------------
// Both are still in 1000000 here, which is what this section needs: the swing goes to the *others*
// in the map, and there has to be a monster for it to land on. Hero's own client already played the
// attack while it built the packet (`sub_512F90` runs the effect functions before it writes), so the
// server's copy must not come back to him - the same rule as the emotion above.
if (altMap === heroMap && heroMap === 1000000) {
  // The mobs this field spawned arrive in `0x2F`, which starts with the mob's object id - the key
  // every later packet uses. They enter on the field's first tick, not necessarily before this line,
  // so this waits for one; the scan keeps every packet it does not use.
  let mobId;
  const deadline = Date.now() + 4000;
  while (mobId === undefined && Date.now() < deadline) {
    const kept = [];
    while (hero.game.queue.length > 0) {
      const packet = hero.game.queue.shift();
      if (packet[0] === 0x2f && mobId === undefined) mobId = new PacketReader(packet, 1).readU32();
      else kept.push(packet);
    }
    hero.game.queue.unshift(...kept);
    if (mobId === undefined) await new Promise((r) => setTimeout(r, 50));
  }
  expect(mobId !== undefined, `the field spawned monsters to swing at (mob ${mobId})`);

  if (mobId !== undefined) {
    const swing = encodeClientAttack({
      hits: 1,
      targetCount: 1,
      skillId: mobId,
      facingLeft: true,
      action: 0x11,
      speed: 2,
      targets: [{ mobId, hitAnimation: -1, x: 0, y: 0, sequence: 3, damages: [1] }],
    });
    hero.game.send(swing); // the probe's send takes the whole packet, opcode first
    const burst = await alt.game.drain(400);
    const sawSwing = burst.findIndex((packet) => packet[0] === FIELD_OPCODE.userAttack);
    const sawMob = burst.findIndex((packet) => packet[0] === 0x34);
    expect(sawSwing >= 0, `the other player sees the swing (0x23) at all`);

    if (sawSwing >= 0) {
      const relayed = readUserAttack(new PacketReader(burst[sawSwing], 1));
      expect(
        relayed.characterId === hero.characterId,
        `the swing is Hero's (id ${relayed.characterId})`,
      );
      expect(
        relayed.facingLeft && relayed.action === 0x11 && relayed.hits === 1 && relayed.speed === 2,
        `carrying what he sent: left, action 0x11, 1 hit, speed 2 (got ` +
          `${relayed.facingLeft ? "left" : "right"} action=${relayed.action} hits=${relayed.hits} speed=${relayed.speed})`,
      );
      const hit = relayed.targets[0];
      expect(
        relayed.targets.length === 1 && hit.mobId === mobId && hit.damages[0] === 1,
        `and the monster it landed on (${hit?.mobId} for ${hit?.damages.join("+")})`,
      );
      expect(
        relayed.afterimage === 0 && relayed.skillLevel === 0,
        "the three fields with no source here are the neutral values, not a guess",
      );
      expect(
        sawMob < 0 || sawSwing < sawMob,
        "the swing is drawn before the mob reacts, which is the order the server sends them in",
      );
    }

    // Nothing comes back to the attacker: his own client played the swing from the same numbers.
    let echoed = 0;
    const until = Date.now() + 400;
    while (Date.now() < until) {
      const held = [];
      while (hero.game.queue.length > 0) {
        const packet = hero.game.queue.shift();
        if (packet[0] === FIELD_OPCODE.userAttack) echoed += 1;
        else held.push(packet);
      }
      hero.game.queue.unshift(...held);
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(echoed === 0, `the attacker is not echoed his own 0x23 (saw ${echoed})`);

    // --- a shot (0x10) and a cast (0x11): 0x24 and 0x25 (FINDINGS 4.11.7c) ------------------------
    // The opcode the server picks is the renderer the observer's client runs, so the other two halves
    // of the family get their own legs. Both carry the same body as the swing; a shot additionally
    // names the projectile, and this character's USE tab is empty, so the server's own record answers
    // "no item in that slot" with 0. (The lookup itself is covered in `serve.test.ts`, which hands the
    // attacker a pile of arrows first.)
    const shot = encodeClientAttack(
      {
        hits: 1,
        targetCount: 1,
        skillId: mobId,
        facingLeft: false,
        action: 0x2e,
        speed: 1,
        projectileSlot: 3,
        targets: [{ mobId, hitAnimation: -1, x: 0, y: 0, sequence: 4, damages: [1] }],
      },
      CLIENT_FIELD_OPCODE.shootAttack,
    );
    hero.game.send(shot);
    const shotBurst = await alt.game.drain(400);
    const sawShot = shotBurst.findIndex((packet) => packet[0] === FIELD_OPCODE.userShootAttack);
    expect(sawShot >= 0, "a shot arrives as 0x24, the opcode whose receiver draws one");
    if (sawShot >= 0) {
      const relayed = readUserAttack(new PacketReader(shotBurst[sawShot], 1));
      expect(
        !relayed.facingLeft &&
          relayed.action === 0x2e &&
          relayed.speed === 1 &&
          relayed.targets[0]?.mobId === mobId,
        `carrying the shot's own fields (action=${relayed.action} speed=${relayed.speed} mob=${relayed.targets[0]?.mobId})`,
      );
      expect(
        relayed.projectileItemId === 0,
        `and the neutral projectile id - the slot names an empty USE slot (got ${relayed.projectileItemId})`,
      );
    }

    const cast = encodeClientAttack(
      {
        hits: 1,
        targetCount: 1,
        skillId: mobId,
        facingLeft: true,
        action: 0x20,
        speed: 3,
        targets: [{ mobId, hitAnimation: 3, x: 0, y: 0, sequence: 5, damages: [1] }],
      },
      CLIENT_FIELD_OPCODE.magicAttack,
    );
    hero.game.send(cast);
    const castBurst = await alt.game.drain(400);
    const sawCast = castBurst.findIndex((packet) => packet[0] === FIELD_OPCODE.userMagicAttack);
    expect(sawCast >= 0, "and a cast arrives as 0x25, never as the shot's opcode");
    if (sawCast >= 0) {
      const relayed = readUserAttack(new PacketReader(castBurst[sawCast], 1));
      expect(
        relayed.facingLeft && relayed.action === 0x20 && relayed.targets[0]?.hitAnimation === 3,
        `with the cast's fields (action=${relayed.action} anim=${relayed.targets[0]?.hitAnimation})`,
      );
      expect(
        relayed.projectileItemId === 0,
        `and the same neutral projectile field: 0x11 has no slot in it to look up (got ${relayed.projectileItemId})`,
      );
    }
  }
}

// --- cross a real map boundary: Alt walks through the 1000000 "east00" portal (-> 1010000) --------
// A second run of the same save skips this: the character records already remember 1010000.
if (altMap === heroMap && altMap === 1000000) {
  const portal = new PacketWriter(32);
  portal.writeByte(0x0d).writeU32(0xffffffff).writeAsciiString("east00"); // -1 = "under the cursor"
  alt.game.send(portal.toBytes());
  await alt.game.take(0x19); // the empty interaction gate a client needs before it looks at 0x16
  altMap = mapIdOfSetField(await alt.game.take(0x16));
  console.log(`  ..   Alt walked through the portal, now in map ${altMap}`);
}
expect(altMap !== heroMap, "the two are on different maps, so the whisper has to cross one");

// --- whisper: Hero -> Alt, text as CP949 bytes ---------------------------------------------------
const text = encodeCp949("안녕");
const whisper = new PacketWriter(64);
whisper.writeByte(0x23).writeByte(0x06).writeAsciiString("Alt").writeStringBytes(text);
hero.game.send(whisper.toBytes());

const heard = await alt.game.take(0x1a);
const heardReader = new PacketReader(heard, 1);
expect(heardReader.readByte() === 0x12, "the receiver gets 0x1a sub-op 0x12 (the chat line)");
expect(heardReader.readAsciiString() === "Hero", "with the sender's name");
expect(Buffer.from(heardReader.readStringBytes()).toString("hex") === "bec8b3e7", "and the bytes that were typed");

const echoed = await hero.game.take(0x1a);
const echoedReader = new PacketReader(echoed, 1);
expect(echoedReader.readByte() === 0x0a, "the asker gets 0x1a sub-op 0x0a");
expect(echoedReader.readAsciiString() === "Alt", "naming the target");
expect(echoedReader.readByte() === 1, "delivered");

// --- find: where is Alt, and where is nobody -----------------------------------------------------
const find = new PacketWriter(32);
find.writeByte(0x23).writeByte(0x05).writeAsciiString("alt"); // lower case on purpose
hero.game.send(find.toBytes());
const where = new PacketReader(await hero.game.take(0x1a), 1);
expect(where.readByte() === 0x09, "the find answer is 0x1a sub-op 0x09");
expect(where.readAsciiString() === "Alt", "and it echoes the stored spelling, not the typed one");
const reportedMap = where.readU32();
expect(reportedMap === altMap, `the map id is the target's (${altMap}), not the asker's (${heroMap})`);

const nowhere = new PacketWriter(32);
nowhere.writeByte(0x23).writeByte(0x05).writeAsciiString("Nobody");
hero.game.send(nowhere.toBytes());
const noReader = new PacketReader(await hero.game.take(0x1a), 1);
expect(noReader.readByte() === 0x09, "an unknown name is the same answer");
expect(noReader.readAsciiString() === "Nobody", "with the typed name");
expect(noReader.readU32() === 0xffffffff, "and 0xffffffff for the map");

// --- a whisper to nobody, and the client's balloon request ---------------------------------------
const lost = new PacketWriter(64);
lost.writeByte(0x23).writeByte(0x06).writeAsciiString("Nobody").writeStringBytes(encodeCp949("hi"));
hero.game.send(lost.toBytes());
const lostReader = new PacketReader(await hero.game.take(0x1a), 1);
expect(lostReader.readByte() === 0x0a, "a whisper to nobody is the 0x0a answer");
expect(lostReader.readAsciiString() === "Nobody", "naming the typed name");
expect(lostReader.readByte() === 0, "with flag 0 = not found");

const balloon = new PacketWriter(64);
balloon.writeByte(0x23).writeByte(0x22).writeAsciiString("Hero").writeStringBytes(encodeCp949("hi"));
hero.game.send(balloon.toBytes());
const quiet = [];
const deadline = Date.now() + 700;
while (Date.now() < deadline) {
  if (hero.game.queue.length > 0) quiet.push(hero.game.queue.shift()[0]);
  await new Promise((r) => setTimeout(r, 20));
}
expect(quiet.filter((opcode) => opcode === 0x1a).length === 0, "a balloon request is not answered");

// --- a monster's hit: the client reports it (0x1C), the server answers with the diff (0x0D) -------
// The damage itself never travels: the 2003 client runs the monster AI and rolls what it takes
// (`sub_511C60` -> `sub_4C8ED0` -> `sub_5114A0`), and its own record is written *only* by the server's
// `0x0D` - so these bytes (what `sub_55B870(-damage, 0, 0)` writes: opcode, `u32 0x1400`, the two
// s16 deltas, the trailing byte) are the whole of "I got hit", and the answer is what moves the bar.
// Hero is at full HP here, so -30 has to come back as 20/50, and one more hit has to land on 0.
const report = (hpDelta, mpDelta) => {
  const bytes = new PacketWriter(16);
  bytes.writeByte(0x1c).writeU32(0x1400).writeU16(hpDelta & 0xffff).writeU16(mpDelta & 0xffff).writeByte(0);
  hero.game.send(bytes.toBytes());
};
report(-30, 0);
const hurtDiff = readStatUpdate(new PacketReader(await hero.game.take(0x0d), 1)).diff;
expect(hurtDiff.hp === 20, `a reported -30 comes back as hp 20 (got ${hurtDiff.hp})`);
report(-30, 0);
const deadDiff = readStatUpdate(new PacketReader(await hero.game.take(0x0d), 1)).diff;
expect(deadDiff.hp === 0, `a hit past zero lands on hp 0, never below (got ${deadDiff.hp})`);

// --- the revive dialog's OK: 0x0D kind 0 -> the release byte, then a field (FINDINGS 4.32) --------
// What `CUIRevive`'s OK button (and Enter) sends is `sub_472590(0, nullptr)`: kind 0, empty name - the
// same packet a portal click uses, with the other kind. Hero is in map 1000000, whose real
// `info/returnMap` is 1010000 (암허스트, a town), so with the real `Data.wz` behind the server this is
// a real map change, into the map Alt walked into above.
//
const revive = new PacketWriter(32);
revive.writeByte(0x0d).writeU32(0).writeAsciiString("");
hero.game.send(revive.toBytes());
await hero.game.take(0x19); // a revive owes the release byte exactly like a click does
const revived = characterOfSetField(await hero.game.take(0x16));
const revivedMap = revived.stats.mapId;
// State-relative on purpose: a field's `info/returnMap` is the town it belongs to (1000000 -> 1010000),
// while a town's own returnMap is itself - so a *second* run against the same save (Hero was left in
// 헤네시스 by the scroll section) revives in place, and that is not a failure.
expect(
  revivedMap === 1010000 || revivedMap === heroMap,
  `the revive follows the record map's info/returnMap (${heroMap} -> ${revivedMap})`,
);
const together = revivedMap === altMap; // both in one map: the arrival/emotion/drag sections need it
expect(revived.stats.hp === revived.stats.maxHp, `and refilled the HP the reports above took away (${revived.stats.hp}/${revived.stats.maxHp})`);

if (!together) {
  console.log(
    `  ..   Hero is in ${revivedMap} and Alt in ${altMap}: the arrival, emotion and drag sections` +
      " need one map, so they print this note instead",
  );
} else {
  // The town Alt is standing in hears Hero come back: the revive joined the new field, it was not just
  // a packet to the one person who died.
  const arrivedUser = readUserEnterField(new PacketReader(await alt.game.take(0x1c), 1));
  expect(arrivedUser.characterId === hero.characterId, `the others see Hero arrive (0x1C id ${arrivedUser.characterId})`);
  // The 0x1C's first u32 is the face the client draws (`sub_507A20` -> `sub_508260` -> `CUser+68`),
  // not an opaque version key, and the hair travels in the avatar list (`sub_42E2C0` puts the
  // record's `appearanceB` into body-part slot 0). Both are filled from the record the login chain
  // created, or with the starter look where it has none (FINDINGS 4.8.1a/4.11.3c).
  const heroLook = hero.character.stats;
  expect(arrivedUser.face === heroLook.appearanceA, `and with Hero's own face (${arrivedUser.face})`);
  expect(
    arrivedUser.avatarItems.includes(heroLook.appearanceB),
    `and his hair (${heroLook.appearanceB}) among the avatar ids [${arrivedUser.avatarItems.join(",")}]`,
  );
  // The clothes the dialog picked are worn equips (FINDINGS 4.8.1a), and `0x1C` is where the other
  // players get them: one list of item ids the client files by part code (`sub_45F340`). On a save
  // that already had the character there is nothing worn to look for, so this only claims what the
  // record it just read actually holds.
  const heroWorn = [...(hero.character.items?.worn.values() ?? [])].map((slot) => slot.itemId);
  expect(
    heroWorn.every((itemId) => arrivedUser.avatarItems.includes(itemId)),
    `and every worn equip [${heroWorn.join(",")}] is in those ids [${arrivedUser.avatarItems.join(",")}]`,
  );

  // --- an emotion: 0x13 out, 0x27 to the rest of the field, nothing back (FINDINGS 4.35) ------------
  // Hero and Alt are both in the town 1010000 here (the revive above moved Hero in). The F-keys are the
  // only sender: `F1`..`F7` send `1`..`7` and the client has already put the face on itself before the
  // packet is built, so the server's job is the broadcast - and the sender must not get an echo.
  hero.game.send(encodeClientEmotion({ emotion: 6 })); // F6 -> "bewildered"
  const emotionPacket = await alt.game.take(0x27);
  const emotionReader = new PacketReader(emotionPacket, 1);
  const emotionOf = emotionReader.readU32();
  const faceIndex = emotionReader.readU32();
  expect(emotionOf === hero.characterId, `the face is Hero's (id ${emotionOf})`);
  expect(faceIndex === 6, `and it is face 6, the one the packet named (got ${faceIndex})`);
  // Hero's queue still holds the town's NPC packets (`0x39`s the shop section below needs), so this
  // looks for an echo without throwing anything away: the 0x27s are counted, everything else is put
  // back in order.
  let echoes = 0;
  const until = Date.now() + 400;
  while (Date.now() < until) {
    const kept = [];
    while (hero.game.queue.length > 0) {
      const packet = hero.game.queue.shift();
      if (packet[0] === 0x27) echoes += 1;
      else kept.push(packet);
    }
    hero.game.queue.unshift(...kept);
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(echoes === 0, `the sender is not echoed the 0x27 (saw ${echoes})`);

  // --- a drag in the inventory window: 0x17 out, 0x0B + 0x28 back (FINDINGS 4.36) --------------------
  // The client moves nothing itself. `sub_55ACB0` sends `[0x17][u8 tab][s16 from][s16 to][s16 count]`
  // and waits for the `0x0B` that says where the item went; a worn item lives at the *negative* slot of
  // the equip tab, so taking the weapon off is `-11` into a bag slot and putting it back is the same
  // drag the other way round. Only a drag that touches a negative slot moves the look, and that is the
  // only case the rest of the map hears about: `0x28` with the new id list, built from the same record
  // `0x1C` reads (`avatarItemsOf`), and never echoed to the player whose own client already drew it.
  //
  // Hero's queue still holds the town's `0x39`s here (the shop section below is the one that reads
  // them), so the wait for the `0x0B` has to leave everything else in place.
  async function takeKeeping(client, opcode, timeoutMs = 2000) {
    const kept = [];
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (client.queue.length > 0) {
        const packet = client.queue.shift();
        if (packet[0] === opcode) {
          client.queue.unshift(...kept);
          return packet;
        }
        kept.push(packet);
      }
      if (Date.now() > deadline) throw new Error(`no 0x${opcode.toString(16)} within ${timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  const wornWeapon = hero.character.items?.worn.get(11)?.itemId;
  expect(wornWeapon !== undefined, `Hero wears a weapon in slot 11 to take off (${wornWeapon})`);
  if (wornWeapon === undefined) {
    console.log("  ..   nothing is worn in slot 11; the drag half of this section cannot run");
  } else {
    hero.game.send(encodeClientChangeSlot({ tab: 1, fromSlot: -11, toSlot: 1, count: -1 }));
    const off = readInventoryChange(new PacketReader(await takeKeeping(hero.game, INVENTORY_OPCODE), 1)).changes;
    expect(
      off[0]?.op === INVENTORY_OP.put && off[0].slot === 1 && off[0].item.itemId === wornWeapon,
      `the 0x0B answer puts the weapon in equip slot 1 (saw ${off[0]?.op}/${off[0]?.slot})`,
    );
    expect(off[1]?.op === INVENTORY_OP.clear && off[1].slot === -11, "and clears the worn slot it came from");

    const stripped = readUserLook(new PacketReader(await alt.game.take(FIELD_OPCODE.userLook), 1));
    expect(
      stripped.characterId === hero.characterId,
      `0x28 tells the rest of the map whose look changed (id ${stripped.characterId})`,
    );
    expect(
      stripped.avatarItems !== undefined && !stripped.avatarItems.includes(wornWeapon),
      `and the weapon is gone from the ids [${stripped.avatarItems?.join(",")}]`,
    );
    const stillOn = [hero.character.stats.appearanceB, ...[...(hero.character.items?.worn ?? new Map()).values()]
      .map((slot) => slot.itemId)
      .filter((itemId) => itemId !== wornWeapon)];
    expect(
      stillOn.every((itemId) => stripped.avatarItems?.includes(itemId)),
      `with the hair and the equips still worn [${stillOn.join(",")}] left in it`,
    );

    hero.game.send(encodeClientChangeSlot({ tab: 1, fromSlot: 1, toSlot: -11, count: -1 }));
    const on = readInventoryChange(new PacketReader(await takeKeeping(hero.game, INVENTORY_OPCODE), 1)).changes;
    expect(
      on[0]?.op === INVENTORY_OP.put && on[0].slot === -11 && on[0].item.itemId === wornWeapon,
      "dragging it back answers with the put at the worn slot",
    );
    expect(on[1]?.op === INVENTORY_OP.clear && on[1].slot === 1, "and clears the bag slot");
    const dressed = readUserLook(new PacketReader(await alt.game.take(FIELD_OPCODE.userLook), 1));
    expect(dressed.avatarItems?.includes(wornWeapon) === true, "and 0x28 puts the weapon back on for the others");

    // A drag the server will not do is answered with the **empty** 0x0B, not silence: the client arms a
    // one-request gate as it sends and only a 0x0B clears it (FINDINGS 4.36.5). Slot 1 is empty again.
    hero.game.send(encodeClientChangeSlot({ tab: 1, fromSlot: 1, toSlot: -11, count: -1 }));
    const refused = readInventoryChange(new PacketReader(await takeKeeping(hero.game, INVENTORY_OPCODE), 1));
    expect(
      refused.result !== 0 && refused.changes.length === 0,
      `a drag of an empty slot is refused with an empty 0x0B (result ${refused.result})`,
    );

    // And the sender is not told about his own look: his client already has it.
    let lookEchoes = 0;
    const untilLook = Date.now() + 400;
    while (Date.now() < untilLook) {
      const kept = [];
      while (hero.game.queue.length > 0) {
        const packet = hero.game.queue.shift();
        if (packet[0] === FIELD_OPCODE.userLook) lookEchoes += 1;
        else kept.push(packet);
      }
      hero.game.queue.unshift(...kept);
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(lookEchoes === 0, `the wearer is not echoed his own 0x28 (saw ${lookEchoes})`);

    // --- a throw-away: 0x17 with `toSlot = 0` out, 0x0B + 0x43 for the whole field (FINDINGS 4.36) --
    // `sub_463BE0` sends `tab, from, 0, 數量` - and for the equip tab the number is a literal 1, because
    // the "몇 개나 버리시겠습니까?" prompt is skipped there. The client never drew the item anywhere but
    // the slot, so two packets have to come back: the `0x0B` that empties it, and the field's `0x43`
    // with **no monster block** (kind 2), which is the only thing that puts it on the ground - for the
    // thrower just as much as for everybody else. It lands at the thrower's feet, and `reachable` only
    // takes a drop that was already there when the player last moved, so it does not come straight
    // back: the thrower has to step off it and back on.
    hero.game.send(encodeClientChangeSlot({ tab: 1, fromSlot: -11, toSlot: 0, count: 1 }));
    const thrown = readInventoryChange(new PacketReader(await takeKeeping(hero.game, INVENTORY_OPCODE), 1)).changes;
    expect(
      thrown.length === 1 && thrown[0]?.op === INVENTORY_OP.clear && thrown[0].slot === -11,
      "throwing the worn weapon away clears the worn slot with 0x0B",
    );
    const onGround = readDropAppear(new PacketReader(await takeKeeping(hero.game, DROP_OPCODE.appear), 1));
    expect(onGround.kind === DROP_KIND.placed, `the drop is kind 2 - placed, no monster (got ${onGround.kind})`);
    expect(onGround.money === false && onGround.value === wornWeapon, `and it is the weapon (${onGround.value})`);
    const othersSaw = readDropAppear(new PacketReader(await alt.game.take(DROP_OPCODE.appear), 1));
    expect(othersSaw.dropId === onGround.dropId, "the thrower is not the only one told: the field gets the same 0x43");
    const bare = readUserLook(new PacketReader(await alt.game.take(FIELD_OPCODE.userLook), 1));
    expect(bare.avatarItems?.includes(wornWeapon) !== true, "and 0x28 takes it off the others' copy of the look");

    // Standing on it is not a pickup: the drop landed after this player last moved.
    await new Promise((r) => setTimeout(r, 600));
    expect(
      hero.game.queue.filter((packet) => packet[0] === DROP_OPCODE.remove).length === 0,
      "the thrower does not pick his own throw-away back up while standing still",
    );

    /** One `0x0E`: the first element of a move path is where the server puts the player. */
    const walk = (x, y) =>
      hero.game.send(
        encodeClientUserMove({
          stageByte: 0,
          path: { originX: 0, originY: 0, elements: [{ attr: 0, x, y, vx: 0, vy: 0, action: 0, foothold: 0, duration: 60 }] },
        }),
      );
    // 80 px away is outside the 40 px reach, and stepping back on is what takes it - on the next tick.
    walk(onGround.x + 80, onGround.y);
    await new Promise((r) => setTimeout(r, 400));
    expect(
      hero.game.queue.filter((packet) => packet[0] === DROP_OPCODE.remove).length === 0,
      "and neither does it fly into his bag from 80 px away",
    );
    walk(onGround.x, onGround.y);
    const taken = readDropRemove(new PacketReader(await takeKeeping(hero.game, DROP_OPCODE.remove), 1));
    expect(
      taken.kind === DROP_REMOVE_KIND.taken && taken.characterId === hero.characterId,
      `walking back onto it takes it (0x44 kind ${taken.kind}, by ${taken.characterId})`,
    );
    const pickedUp = readInventoryChange(new PacketReader(await takeKeeping(hero.game, INVENTORY_OPCODE), 1)).changes;
    expect(
      pickedUp[0]?.op === INVENTORY_OP.put && pickedUp[0].item.itemId === wornWeapon,
      `and the item goes to a bag slot, not back on the body (slot ${pickedUp[0]?.slot})`,
    );
    const lootLine = readLootNotice(new PacketReader(await takeKeeping(hero.game, LOOT_OPCODE), 1));
    expect(
      lootLine.kind === "item" && lootLine.itemId === wornWeapon,
      `with the 0x11 line for the item (${lootLine.itemId} x${lootLine.count})`,
    );

    // Put it back on, so the shop section below starts where this one found the character: a drag is
    // the only thing that wears something.
    hero.game.send(encodeClientChangeSlot({ tab: 1, fromSlot: pickedUp[0].slot, toSlot: -11, count: -1 }));
    const dressedAgain = readInventoryChange(new PacketReader(await takeKeeping(hero.game, INVENTORY_OPCODE), 1)).changes;
    expect(
      dressedAgain[0]?.op === INVENTORY_OP.put && dressedAgain[0].slot === -11,
      "dragging the picked-up weapon back on answers with the worn slot",
    );
    const dressedLook = readUserLook(new PacketReader(await alt.game.take(FIELD_OPCODE.userLook), 1));
    expect(dressedLook.avatarItems?.includes(wornWeapon) === true, "and the others see it worn again");
  }

}

// --- using what a shop sold: 0x18 restores, 0x19 changes the map (FINDINGS 4.34) -------------------
// The client never applies an item by itself. `sub_462DC0` (inventory double-click) and `sub_512570`
// (quickslot) send `0x18` for the 200/201/202 families and `0x19` for 203, `[opcode][s16 slot][u32
// itemId]`, and the shared prologue refuses to send at all while another use is pending - so what
// the item does is whatever the server's `0x0B`/`0x0D`/`0x16` answer says. The one purchasable,
// usable thing a fresh character can afford is 헤네시스 귀환 주문서 (`Item/Consume/0203.img/02030004`,
// `spec/moveTo = 100000000`, price 90), sold by 마이 (12100) - the town NPC the revive above landed
// next to - so the section buys it and then uses it, and the map has to really change.
const town = await hero.game.drain(500);
const poolIds = new Map();
for (const packet of town) {
  if (packet[0] !== NPC_OPCODE.enterField) continue;
  const npc = readNpcEnterField(new PacketReader(packet, 1));
  if (npc.templateId !== undefined) poolIds.set(npc.templateId, npc.npcId);
}
const mai = poolIds.get(12100);
// Only a claim about the town: on a second run against the same save Hero revives in 헤네시스 (above),
// which has no 마이, and the note below is the honest answer instead of a failure.
expect(
  mai !== undefined || revivedMap !== 1010000,
  `the town burst names 마이 (12100), with the pool id a click needs (${mai})`,
);
const wallet = revived.stats.mesos;
if (mai === undefined) {
  console.log("  ..   no 마이 to click; the buying half of this section cannot run");
} else if (wallet < 90) {
  console.log(`  ..   Hero has ${wallet} mesos - start the server with --start-mesos 200 on a fresh save`);
} else {
  // Clicking the NPC: what `sub_55AF20` sends is the pool id, and the answer is the release gate
  // (`0x19`, empty) followed by the window (`0x4A`).
  hero.game.send(encodeClientObjectClick({ objectId: mai }));
  await hero.game.take(0x19);
  const shop = readShopOpen(new PacketReader(await hero.game.take(SHOP_OPEN_OPCODE), 1));
  expect(shop.shopId === 12100, `마이's shop is keyed by the NPC template id (${shop.shopId})`);
  const row = shop.items.findIndex((line) => line.itemId === 2030004);
  const price = row < 0 ? undefined : shop.items[row].price;
  expect(price === 90, `and 헤네시스 귀환 주문서 is on sale for the archive's own price (${price})`);

  hero.game.send(encodeClientShopRequest({ kind: "buy", row, itemId: 2030004, count: 1 }));
  const bought = await hero.game.take(SHOP_RESULT_OPCODE);
  expect(bought[1] === SHOP_RESULT.silent, "the purchase answers 0x4B silent (a trade says nothing)");
  const put = readInventoryChange(new PacketReader(await hero.game.take(INVENTORY_OPCODE), 1)).changes[0];
  expect(put?.op === INVENTORY_OP.put && put.item.itemId === 2030004, "0x0B puts the scroll in the USE tab");
  const paid = readStatUpdate(new PacketReader(await hero.game.take(0x0d), 1)).diff;
  expect(paid.mesos === wallet - 90, `and the wallet went ${wallet} -> ${paid.mesos}`);

  // The use itself: `[0x19][slot][itemId]` - the same two fields `0x18` carries, with the item id
  // deciding the family. `0x0B` takes it out of the slot and `0x16` carries the new map, whose id is
  // the one the item's own `spec/moveTo` names, not anything the server chose.
  const slot = put.slot;
  hero.game.send(encodeClientUseItem({ slot, itemId: 2030004 }, CLIENT_FIELD_OPCODE.useMapItem));
  const used = readInventoryChange(new PacketReader(await hero.game.take(INVENTORY_OPCODE), 1)).changes[0];
  expect(used?.op === INVENTORY_OP.clear, "using the scroll takes it out of the slot");
  const landed = mapIdOfSetField(await hero.game.take(0x16));
  expect(landed === 100000000, `and 0x16 really lands in 헤네시스 (100000000), got ${landed}`);
}

hero.game.close();
alt.game.close();
console.log(failures.length === 0 ? "\nPROBE PASS" : `\nPROBE FAIL: ${failures.join(" | ")}`);
process.exit(failures.length === 0 ? 0 : 1);
