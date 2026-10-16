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
 * so a fresh `--save` file is the easiest way to run it. `--data` is what makes the find answer
 * carry a real map id: after both players land in 1000000 the probe walks Alt through that map's
 * "east00" portal (0x0D), so the whisper really does cross a map boundary. It ends with the revive
 * dialog's request (0x0D `kind = 0`, FINDINGS 4.32), which turns 1000000's `info/returnMap` - the real
 * 1010000 - into the map the dead player is put back into. Before that it plays the client's own half
 * of a monster's hit (c2s `0x1C`, FINDINGS 4.33: report the signed HP/MP delta, read the `0x0D` that
 * comes back) so the revive has something to refill.
 */
import net from "node:net";
import { CipherState, CLIENT_SEND_MAGIC, SERVER_SEND_MAGIC } from "../src/protocol/cipher.ts";
import { encodeSessionPacket, SessionDeframer } from "../src/protocol/session.ts";
import { PacketReader, PacketWriter } from "../src/protocol/packet.ts";
import { readCharacterData } from "../src/protocol/chardata.ts";
import { encodeCp949 } from "../src/protocol/cp949.ts";
import { readStatUpdate } from "../src/protocol/stat.ts";

const [loginPort, gamePort] = process.argv.slice(2).map(Number);

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
    const check = new PacketWriter(64);
    check.writeByte(0x06).writeAsciiString(wanted);
    for (let i = 0; i < 10; i++) check.writeU32(0);
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
    list.push(readCharacterData(new PacketReader(createReply, 2)));
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
  return { game, name: character.stats.name, characterId: handoff };
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
expect(revivedMap === 1010000, `the revive moved Hero into info/returnMap (1010000), got ${revivedMap}`);
expect(revivedMap === altMap, "and that is the map the whisper crossed into");
expect(revived.stats.hp === revived.stats.maxHp, `and refilled the HP the reports above took away (${revived.stats.hp}/${revived.stats.maxHp})`);

// The town Alt is standing in hears Hero come back: the revive joined the new field, it was not just
// a packet to the one person who died.
const arrived = new PacketReader(await alt.game.take(0x1c), 1).readU32();
expect(arrived === hero.characterId, `the others see Hero arrive (0x1C id ${arrived})`);

hero.game.close();
alt.game.close();
console.log(failures.length === 0 ? "\nPROBE PASS" : `\nPROBE FAIL: ${failures.join(" | ")}`);
process.exit(failures.length === 0 ? 0 : 1);
