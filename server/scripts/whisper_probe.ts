/** Historical cross-system native smoke, now typed and fail-fast; NOT current gameplay certification.
 * bun server/scripts/whisper_probe.ts <fixtureLoginPort> <fixtureGamePort> --allow-state-changes
 * Explicit PROBE_ACCOUNT/PASSWORD and PROBE_ALT_ACCOUNT/PASSWORD only. No import side effects.
 * This creates characters and mutates a disposable fixture; never use the user-facing service.
 * The old attack/ammo/HP/portal assumptions still need reconciliation with current WZ/native
 * admission. The old “105 PASS” result must not be carried forward: see BROWSER_TOOL_CLEANUP.md.
 * Every first failed assertion/timeout closes all connections. CLI acknowledgement is NOT proof
 * of save isolation. Import/transport/creation-fixture tests do not execute this scenario.
 */
import { ProbeSession as Client } from "./probe-session.ts";
import { nativeProbeOptions, fixturePort, type NativeProbeOptions } from "./probe-options.ts";
import { validateCreationLook } from "../src/game/creation.ts";
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
import { encodeClientPartyRequest, readPartyResult } from "../src/protocol/party.ts";
import { encodeClientFameRequest, readFameResult } from "../src/protocol/fame.ts";
import { encodeClientMiniRoomRequest, readMiniRoomResult } from "../src/protocol/miniroom.ts";
import {
  MESSENGER_OPCODE,
  encodeClientMessengerRequest,
  readMessengerResult,
} from "../src/protocol/messenger.ts";
import {
  SHOP_OPEN_OPCODE,
  SHOP_RESULT,
  SHOP_RESULT_OPCODE,
  encodeClientObjectClick,
  encodeClientShopRequest,
  readShopOpen,
} from "../src/protocol/shop.ts";

/** Read-only verified against Etc/MakeCharInfo.img/CharMale; dice follow sub_430630/430690.
 * Fixed samples are fixture policy, not the native random distribution. Names satisfy the native
 * 4..12 byte rule; the previous Alt/22-point dice/non-catalogue clothes were invalid.
 */
export const WHISPER_FIXTURE = {
  hero: "ProbeHero",
  alt: "ProbeAlt",
  look: [20000, 30000, 1040002, 1060002, 1072001, 1302000, 5, 5, 5, 10],
} as const;

export async function runWhisperProbe(options: NativeProbeOptions) {
  const { loginPort, gamePort } = options;
  fixturePort(String(loginPort));
  fixturePort(String(gamePort));
  if (loginPort === gamePort) throw new Error("Login/game ports must be different");
  console.warn(
    "Historical cross-system scenarios are not certified against current attack/ammo/HP admission; disposable fixture only.",
  );
  const clients = new Set<Client>();
  async function connect(port: number) {
    const client = await Client.connect(port);
    clients.add(client);
    return client;
  }

  const DIALOG_LOOK = validateCreationLook(WHISPER_FIXTURE.look);

  /** Logs in, makes sure the account has a character, and hands that character to the game server. */
  async function enterGame(user: string, password: string, wanted: string) {
    const login = await connect(loginPort);
    const loginBody = new PacketWriter(64);
    loginBody.writeByte(0x01).writeAsciiString(user).writeAsciiString(password);
    login.send(loginBody.toBytes());
    const loginReply = await login.take(0x01);
    const result = new PacketReader(loginReply, 1).readByte();
    if (result !== 0 && result !== 1 && result < 10)
      throw new Error(`login refused with result ${result}`);

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
    console.log(
      `  ${user}: ${count} character(s) [${list.map((c) => `${c.stats.name}#${c.stats.id}`).join(", ")}]`,
    );

    if (!list.some((character) => character.stats.name === wanted)) {
      // Native flow: c2s 0x05 checks only the name; c2s 0x06 creates with six male
      // MakeCharInfo choices followed by STR/DEX/INT/LUK (each >=4, total25).
      const check = new PacketWriter(32);
      check.writeByte(0x05).writeAsciiString(wanted);
      login.send(check.toBytes());
      const checkReply = await login.take(0x04);
      const checkResult = (checkReply[checkReply.length - 1]! << 24) >> 24;
      console.log(`  ${user}: name "${wanted}" check -> result ${checkResult}`);
      if (checkResult !== 0) throw new Error(`name check refused for ${user}: ${checkResult}`);

      const create = new PacketWriter(64);
      create.writeByte(0x06).writeAsciiString(wanted);
      for (const word of DIALOG_LOOK) create.writeU32(word);
      login.send(create.toBytes());
      const createReply = await login.take(0x05);
      const flag = createReply[1];
      console.log(`  ${user}: create "${wanted}" -> flag ${flag}`);
      if (flag === 0) throw new Error(`create refused for ${user}`);
      const created = readCharacterData(new PacketReader(createReply, 2));
      expect(
        [...(created.items?.worn.keys() ?? [])].join(",") === "5,6,7,11",
        `the four wardrobe words came back as worn equips in slots [${[...(created.items?.worn.keys() ?? [])].join(",")}]`,
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
    const ip = [ipWire & 0xff, (ipWire >>> 8) & 0xff, (ipWire >>> 16) & 0xff, ipWire >>> 24].join(
      ".",
    );
    const port = selectReader.readU16();
    const handoff = selectReader.readU32();
    console.log(
      `  ${user}: "${character.stats.name}" -> ${ip}:${port} as 0x${handoff.toString(16)}`,
    );
    login.close();

    const game = await connect(gamePort);
    const claim = new PacketWriter(8);
    claim.writeByte(0x04).writeU32(handoff);
    game.send(claim.toBytes());
    return { game, name: character.stats.name, characterId: handoff, character };
  }

  /** `0x16` = opcode, mode, "carries data", three seed u32s, then the full CharacterData. */
  function characterOfSetField(packet: Uint8Array) {
    return readCharacterData(new PacketReader(packet, 15));
  }

  function mapIdOfSetField(packet: Uint8Array) {
    return characterOfSetField(packet).stats.mapId;
  }

  let checks = 0;
  function expect(condition: unknown, what: string): asserts condition {
    checks++;
    if (!condition) throw new Error(`Probe assertion failed: ${what}`);
    console.log(`  ok   ${what}`);
  }

  try {
    const hero = await enterGame(
      options.account.user,
      options.account.password,
      WHISPER_FIXTURE.hero,
    );
    const heroMap = mapIdOfSetField(await hero.game.take(0x16)); // the field we were put into
    const alt = await enterGame(options.other.user, options.other.password, WHISPER_FIXTURE.alt);
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
      const mobId = new PacketReader(await hero.game.take(0x2f, 4000), 1).readU32();
      const swing = encodeClientAttack({
        hits: 1,
        targetCount: 1,
        skillId: 0,
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
          relayed.facingLeft &&
            relayed.action === 0x11 &&
            relayed.hits === 1 &&
            relayed.speed === 2,
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
      const echoed = (await hero.game.drain(400, FIELD_OPCODE.userAttack)).length;
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
          skillId: 0,
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
          skillId: 0,
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
    whisper
      .writeByte(0x23)
      .writeByte(0x06)
      .writeAsciiString(WHISPER_FIXTURE.alt)
      .writeStringBytes(text);
    hero.game.send(whisper.toBytes());

    const heard = await alt.game.take(0x1a);
    const heardReader = new PacketReader(heard, 1);
    expect(heardReader.readByte() === 0x12, "the receiver gets 0x1a sub-op 0x12 (the chat line)");
    expect(heardReader.readAsciiString() === WHISPER_FIXTURE.hero, "with the sender's name");
    expect(
      Buffer.from(heardReader.readStringBytes()).toString("hex") === "bec8b3e7",
      "and the bytes that were typed",
    );

    const echoed = await hero.game.take(0x1a);
    const echoedReader = new PacketReader(echoed, 1);
    expect(echoedReader.readByte() === 0x0a, "the asker gets 0x1a sub-op 0x0a");
    expect(echoedReader.readAsciiString() === WHISPER_FIXTURE.alt, "naming the target");
    expect(echoedReader.readByte() === 1, "delivered");

    // --- find: where is Alt, and where is nobody -----------------------------------------------------
    const find = new PacketWriter(32);
    find.writeByte(0x23).writeByte(0x05).writeAsciiString("alt"); // lower case on purpose
    hero.game.send(find.toBytes());
    const where = new PacketReader(await hero.game.take(0x1a), 1);
    expect(where.readByte() === 0x09, "the find answer is 0x1a sub-op 0x09");
    expect(
      where.readAsciiString() === WHISPER_FIXTURE.alt,
      "and it echoes the stored spelling, not the typed one",
    );
    const reportedMap = where.readU32();
    expect(
      reportedMap === altMap,
      `the map id is the target's (${altMap}), not the asker's (${heroMap})`,
    );

    const nowhere = new PacketWriter(32);
    nowhere.writeByte(0x23).writeByte(0x05).writeAsciiString("Nobody");
    hero.game.send(nowhere.toBytes());
    const noReader = new PacketReader(await hero.game.take(0x1a), 1);
    expect(noReader.readByte() === 0x09, "an unknown name is the same answer");
    expect(noReader.readAsciiString() === "Nobody", "with the typed name");
    expect(noReader.readU32() === 0xffffffff, "and 0xffffffff for the map");

    // --- a whisper to nobody, and an unsolicited refusal (ADR-059) ---------------------------------------
    const lost = new PacketWriter(64);
    lost
      .writeByte(0x23)
      .writeByte(0x06)
      .writeAsciiString("Nobody")
      .writeStringBytes(encodeCp949("hi"));
    hero.game.send(lost.toBytes());
    const lostReader = new PacketReader(await hero.game.take(0x1a), 1);
    expect(lostReader.readByte() === 0x0a, "a whisper to nobody is the 0x0a answer");
    expect(lostReader.readAsciiString() === "Nobody", "naming the typed name");
    expect(lostReader.readByte() === 0, "with flag 0 = not found");

    const refusal = new PacketWriter(64);
    refusal
      .writeByte(0x23)
      .writeByte(0x22)
      .writeAsciiString(WHISPER_FIXTURE.hero)
      .writeStringBytes(encodeCp949("hi"));
    hero.game.send(refusal.toBytes());
    const quiet = await hero.game.drain(700, 0x1a);
    expect(quiet.length === 0, "an unsolicited refusal with a false own-name is ignored");

    // --- a monster's hit: the client reports it (0x1C), the server answers with the diff (0x0D) -------
    // The damage itself never travels: the 2003 client runs the monster AI and rolls what it takes
    // (`sub_511C60` -> `sub_4C8ED0` -> `sub_5114A0`), and its own record is written *only* by the server's
    // `0x0D` - so these bytes (what `sub_55B870(-damage, 0, 0)` writes: opcode, `u32 0x1400`, the two
    // s16 deltas, the trailing byte) are the whole of "I got hit", and the answer is what moves the bar.
    // Hero is at full HP here, so -30 has to come back as 20/50, and one more hit has to land on 0.
    const report = (hpDelta: number, mpDelta: number) => {
      const bytes = new PacketWriter(16);
      bytes
        .writeByte(0x1c)
        .writeU32(0x1400)
        .writeU16(hpDelta & 0xffff)
        .writeU16(mpDelta & 0xffff)
        .writeByte(0);
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
    // The wallet as the record sees it here; the trade section below spends out of it, so the shop
    // section has to start from what is left rather than from this snapshot.
    let heroWallet = revived.stats.mesos;
    // State-relative on purpose: a field's `info/returnMap` is the town it belongs to (1000000 -> 1010000),
    // while a town's own returnMap is itself - so a *second* run against the same save (Hero was left in
    // 헤네시스 by the scroll section) revives in place, and that is not a failure.
    expect(
      revivedMap === 1010000 || revivedMap === heroMap,
      `the revive follows the record map's info/returnMap (${heroMap} -> ${revivedMap})`,
    );
    const together = revivedMap === altMap; // both in one map: the arrival/emotion/drag sections need it
    expect(
      revived.stats.hp === revived.stats.maxHp,
      `and refilled the HP the reports above took away (${revived.stats.hp}/${revived.stats.maxHp})`,
    );

    if (!together) {
      console.log(
        `  ..   Hero is in ${revivedMap} and Alt in ${altMap}: the arrival, emotion, drag and party` +
          " sections need one map, so they print this note instead",
      );
    } else {
      // The town Alt is standing in hears Hero come back: the revive joined the new field, it was not just
      // a packet to the one person who died.
      const arrivedUser = readUserEnterField(new PacketReader(await alt.game.take(0x1c), 1));
      expect(
        arrivedUser.characterId === hero.characterId,
        `the others see Hero arrive (0x1C id ${arrivedUser.characterId})`,
      );
      // The 0x1C's first u32 is the face the client draws (`sub_507A20` -> `sub_508260` -> `CUser+68`),
      // not an opaque version key, and the hair travels in the avatar list (`sub_42E2C0` puts the
      // record's `appearanceB` into body-part slot 0). Both are filled from the record the login chain
      // created, or with the starter look where it has none (FINDINGS 4.8.1a/4.11.3c).
      const heroLook = hero.character.stats;
      expect(
        arrivedUser.face === heroLook.appearanceA,
        `and with Hero's own face (${arrivedUser.face})`,
      );
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
      const echoes = (await hero.game.drain(400, 0x27)).length;
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
      const takeKeeping = (client: Client, opcode: number, timeoutMs = 2000) =>
        client.take(opcode, timeoutMs);

      const wornWeapon = hero.character.items?.worn.get(11)?.itemId;
      expect(
        wornWeapon !== undefined,
        `Hero wears a weapon in slot 11 to take off (${wornWeapon})`,
      );
      if (wornWeapon === undefined) {
        console.log("  ..   nothing is worn in slot 11; the drag half of this section cannot run");
      } else {
        hero.game.send(encodeClientChangeSlot({ tab: 1, fromSlot: -11, toSlot: 1, count: -1 }));
        const off = readInventoryChange(
          new PacketReader(await takeKeeping(hero.game, INVENTORY_OPCODE), 1),
        ).changes;
        expect(
          off[0]?.op === INVENTORY_OP.put && off[0].slot === 1 && off[0].item.itemId === wornWeapon,
          `the 0x0B answer puts the weapon in equip slot 1 (saw ${off[0]?.op}/${off[0]?.slot})`,
        );
        expect(
          off[1]?.op === INVENTORY_OP.clear && off[1].slot === -11,
          "and clears the worn slot it came from",
        );

        const stripped = readUserLook(
          new PacketReader(await alt.game.take(FIELD_OPCODE.userLook), 1),
        );
        expect(
          stripped.characterId === hero.characterId,
          `0x28 tells the rest of the map whose look changed (id ${stripped.characterId})`,
        );
        expect(
          stripped.avatarItems !== undefined && !stripped.avatarItems.includes(wornWeapon),
          `and the weapon is gone from the ids [${stripped.avatarItems?.join(",")}]`,
        );
        const stillOn = [
          hero.character.stats.appearanceB,
          ...[...(hero.character.items?.worn ?? new Map()).values()]
            .map((slot) => slot.itemId)
            .filter((itemId) => itemId !== wornWeapon),
        ];
        expect(
          stillOn.every((itemId) => stripped.avatarItems?.includes(itemId)),
          `with the hair and the equips still worn [${stillOn.join(",")}] left in it`,
        );

        hero.game.send(encodeClientChangeSlot({ tab: 1, fromSlot: 1, toSlot: -11, count: -1 }));
        const on = readInventoryChange(
          new PacketReader(await takeKeeping(hero.game, INVENTORY_OPCODE), 1),
        ).changes;
        expect(
          on[0]?.op === INVENTORY_OP.put && on[0].slot === -11 && on[0].item.itemId === wornWeapon,
          "dragging it back answers with the put at the worn slot",
        );
        expect(on[1]?.op === INVENTORY_OP.clear && on[1].slot === 1, "and clears the bag slot");
        const dressed = readUserLook(
          new PacketReader(await alt.game.take(FIELD_OPCODE.userLook), 1),
        );
        expect(
          dressed.avatarItems?.includes(wornWeapon) === true,
          "and 0x28 puts the weapon back on for the others",
        );

        // A drag the server will not do is answered with the **empty** 0x0B, not silence: the client arms a
        // one-request gate as it sends and only a 0x0B clears it (FINDINGS 4.36.5). Slot 1 is empty again.
        hero.game.send(encodeClientChangeSlot({ tab: 1, fromSlot: 1, toSlot: -11, count: -1 }));
        const refused = readInventoryChange(
          new PacketReader(await takeKeeping(hero.game, INVENTORY_OPCODE), 1),
        );
        expect(
          refused.result !== 0 && refused.changes.length === 0,
          `a drag of an empty slot is refused with an empty 0x0B (result ${refused.result})`,
        );

        // And the sender is not told about his own look: his client already has it.
        const lookEchoes = (await hero.game.drain(400, FIELD_OPCODE.userLook)).length;
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
        const thrown = readInventoryChange(
          new PacketReader(await takeKeeping(hero.game, INVENTORY_OPCODE), 1),
        ).changes;
        expect(
          thrown.length === 1 && thrown[0]?.op === INVENTORY_OP.clear && thrown[0].slot === -11,
          "throwing the worn weapon away clears the worn slot with 0x0B",
        );
        const onGround = readDropAppear(
          new PacketReader(await takeKeeping(hero.game, DROP_OPCODE.appear), 1),
        );
        expect(
          onGround.kind === DROP_KIND.placed,
          `the drop is kind 2 - placed, no monster (got ${onGround.kind})`,
        );
        expect(
          onGround.money === false && onGround.value === wornWeapon,
          `and it is the weapon (${onGround.value})`,
        );
        const othersSaw = readDropAppear(
          new PacketReader(await alt.game.take(DROP_OPCODE.appear), 1),
        );
        expect(
          othersSaw.dropId === onGround.dropId,
          "the thrower is not the only one told: the field gets the same 0x43",
        );
        const bare = readUserLook(new PacketReader(await alt.game.take(FIELD_OPCODE.userLook), 1));
        expect(
          bare.avatarItems?.includes(wornWeapon) !== true,
          "and 0x28 takes it off the others' copy of the look",
        );

        // Standing on it is not a pickup: the drop landed after this player last moved.
        await new Promise((r) => setTimeout(r, 600));
        expect(
          hero.game.pendingCount(DROP_OPCODE.remove) === 0,
          "the thrower does not pick his own throw-away back up while standing still",
        );

        /** One `0x0E`: its single terminal record is where the server puts the player. */
        const walk = (x: number, y: number) =>
          hero.game.send(
            encodeClientUserMove({
              stageByte: 0,
              path: {
                originX: 0,
                originY: 0,
                elements: [{ attr: 0, x, y, vx: 0, vy: 0, action: 0, foothold: 0, duration: 60 }],
              },
            }),
          );
        // 80 px away is outside the 40 px reach, and stepping back on is what takes it - on the next tick.
        walk(onGround.x + 80, onGround.y);
        await new Promise((r) => setTimeout(r, 400));
        expect(
          hero.game.pendingCount(DROP_OPCODE.remove) === 0,
          "and neither does it fly into his bag from 80 px away",
        );
        walk(onGround.x, onGround.y);
        const taken = readDropRemove(
          new PacketReader(await takeKeeping(hero.game, DROP_OPCODE.remove), 1),
        );
        expect(
          taken.kind === DROP_REMOVE_KIND.taken && taken.characterId === hero.characterId,
          `walking back onto it takes it (0x44 kind ${taken.kind}, by ${taken.characterId})`,
        );
        const pickedUp = readInventoryChange(
          new PacketReader(await takeKeeping(hero.game, INVENTORY_OPCODE), 1),
        ).changes;
        expect(
          pickedUp[0]?.op === INVENTORY_OP.put && pickedUp[0].item.itemId === wornWeapon,
          `and the item goes to a bag slot, not back on the body (slot ${pickedUp[0]?.slot})`,
        );
        const lootLine = readLootNotice(
          new PacketReader(await takeKeeping(hero.game, LOOT_OPCODE), 1),
        );
        expect(
          lootLine.kind === "item" && lootLine.itemId === wornWeapon,
          `with the 0x11 line for the item (${lootLine.kind === "item" ? lootLine.itemId : lootLine.kind} x${lootLine.kind === "item" ? lootLine.count : lootLine.kind})`,
        );

        // Put it back on, so the shop section below starts where this one found the character: a drag is
        // the only thing that wears something.
        hero.game.send(
          encodeClientChangeSlot({ tab: 1, fromSlot: pickedUp[0].slot, toSlot: -11, count: -1 }),
        );
        const dressedAgain = readInventoryChange(
          new PacketReader(await takeKeeping(hero.game, INVENTORY_OPCODE), 1),
        ).changes;
        expect(
          dressedAgain[0]?.op === INVENTORY_OP.put && dressedAgain[0].slot === -11,
          "dragging the picked-up weapon back on answers with the worn slot",
        );
        const dressedLook = readUserLook(
          new PacketReader(await alt.game.take(FIELD_OPCODE.userLook), 1),
        );
        expect(
          dressedLook.avatarItems?.includes(wornWeapon) === true,
          "and the others see it worn again",
        );
      }

      // --- a party: 0x26 out, 0x10 back (FINDINGS 4.37) ------------------------------------------------
      // The four commands are the only senders: `/파티만들기` (type 0) and `/파티탈퇴` (type 1) carry no
      // target, `/파티초대 <name>` (3) and `/파티강퇴 <name>` (4) carry the target's character id, and the
      // invite dialog's "yes" is type 2 with the id the `0x10` type 3 handed the client. The roster is a
      // 102-byte table - `u32 characterId[6]` then `char name[6][13]` - which is what `sub_45F5C0` copies.
      const partyOf = async (client: Client, keep = false) =>
        readPartyResult(
          new PacketReader(keep ? await takeKeeping(client, 0x10) : await client.take(0x10), 1),
        );
      const roster = (result: ReturnType<typeof readPartyResult>) =>
        result.kind === "joined"
          ? result.members.map((member) => member.name).join(",")
          : result.kind;

      hero.game.send(encodeClientPartyRequest({ kind: "create" }));
      const created = await partyOf(hero.game, true);
      expect(
        created.kind === "created" && created.partyId > 0,
        `Hero creates a party (0x10 type 6, id ${created.kind === "created" ? created.partyId : created.kind})`,
      );

      hero.game.send(
        encodeClientPartyRequest({ kind: "invite", targetId: alt.character.stats.id }),
      );
      const invited = await partyOf(alt.game, false);
      expect(
        invited.kind === "invite" &&
          invited.inviterId === hero.character.stats.id &&
          invited.inviterName === hero.character.stats.name,
        `Alt is invited by Hero (type 3, "${invited.kind === "invite" ? invited.inviterName : invited.kind}")`,
      );

      alt.game.send(
        encodeClientPartyRequest({
          kind: "accept",
          inviterId: invited.kind === "invite" ? invited.inviterId : 0,
        }),
      );
      const joinedHero = await partyOf(hero.game, true);
      const joinedAlt = await partyOf(alt.game, false);
      expect(
        joinedHero.kind === "joined" &&
          joinedHero.partyId === created.partyId &&
          joinedHero.members.length === 2,
        `the roster grows to two [${roster(joinedHero)}]`,
      );
      expect(
        joinedAlt.kind === "joined" && joinedAlt.name === alt.character.stats.name,
        `and the joiner is told with its own name ("${joinedAlt.kind === "joined" ? joinedAlt.name : joinedAlt.kind}")`,
      );

      // Alt leaves: `flag 1` means "somebody left", and the table is already the one without Alt. The
      // leaver gets the same packet - that is the only thing that clears its own party id.
      alt.game.send(encodeClientPartyRequest({ kind: "leave", unknown: 0 }));
      const leftHero = await partyOf(hero.game, true);
      const leftAlt = await partyOf(alt.game, false);
      expect(
        leftHero.kind === "left" &&
          leftHero.kicked === false &&
          leftHero.characterId === alt.character.stats.id,
        `Alt's leave is a type 10 flag 1 (${leftHero.kind})`,
      );
      expect(
        leftHero.kind === "left" &&
          leftHero.members.length === 1 &&
          leftHero.members[0].characterId === hero.character.stats.id,
        "and the roster is already [Hero]",
      );
      expect(
        leftAlt.kind === "left" && leftAlt.characterId === alt.character.stats.id,
        "the leaver hears it too",
      );

      // The leader leaving is `flag 0`: no roster, no name, and every member clears its own party id.
      hero.game.send(encodeClientPartyRequest({ kind: "leave", unknown: 0 }));
      const endedHero = await partyOf(hero.game, true);
      expect(
        endedHero.kind === "ended" && endedHero.leaderId === hero.character.stats.id,
        `Hero's leave ends the party (type 10 flag 0, leader ${endedHero.kind === "ended" ? endedHero.leaderId : endedHero.kind})`,
      );
      // Alt left the roster a moment ago, so the disband is not its business: only the leader's own last
      // member gets the `flag 0` packet.
      expect(
        (await alt.game.drain(300)).filter((packet) => packet[0] === 0x10).length === 0,
        "and Alt, who left before the disband, is not told about it",
      );
      // A leave with no party: `sub_471E90` refuses it locally, so this is the server's own guard - and it
      // still answers, because a client that is waiting for an answer must not be left waiting.
      alt.game.send(encodeClientPartyRequest({ kind: "leave", unknown: 0 }));
      const noParty = await partyOf(alt.game, false);
      expect(
        noParty.kind === "notInParty",
        `a leave with no party answers type 11 (${noParty.kind})`,
      );

      // --- fame: 0x20 out, 0x12 back (FINDINGS 4.38) ---------------------------------------------------
      // Both characters are level 1-2 here and the rule is level 15 (`FAME_MIN_LEVEL`), so this pair can
      // only exercise the refusal: `type 2` to the giver, and **nothing at all** for the target - a
      // refused fame is not news for anybody else. The happy path (type 0 + type 5 + a `0x0D` fame diff)
      // lives in `serve.test.ts`, where the records say level 30.
      hero.game.send(encodeClientFameRequest({ targetId: alt.character.stats.id, up: true }));
      const famous = readFameResult(new PacketReader(await takeKeeping(hero.game, 0x12), 1));
      expect(
        famous.kind === "beginner",
        `a level-${hero.character.stats.level} giver is refused as a beginner (0x12 type 2)`,
      );
      expect(
        (await alt.game.drain(300)).filter((packet) => packet[0] === 0x12).length === 0,
        "and the target hears nothing about a refused fame",
      );

      // --- a trade: 0x25 out, 0x50 back (FINDINGS §4.40) ----------------------------------------------
      // The whole handshake is four packets: `/교환` (type 0, `[kind 1][u32 target]`), the invite (`0x50`
      // type 1), the modal's "yes" (type 3, the inviter's id echoed), and the room (`0x50` type 4, kind 1
      // or `sub_481570` returns null and the client disconnects). Then the two sides put money in (type
      // 12), confirm (type 13) and both windows lock (`0x50` type 13) right before the swap.
      //
      // Nothing here needs an item in the bag: mesos move the same way, and the `0x0D` that follows the
      // swap is the proof that the record really changed on both sides.
      const heroId = hero.character.stats.id;
      const altId = alt.character.stats.id;
      // Alt's wallet is the one its own login record carried: nothing else in this probe spends Alt's
      // money, so the copy the client was handed at login is still the balance.
      const altBefore = alt.character.stats.mesos;
      const tradeMesos = Math.min(30, revived.stats.mesos);
      if (tradeMesos === 0) {
        console.log(
          "  ..   Hero has 0 mesos - start the server with --start-mesos 200 on a fresh save",
        );
      } else {
        const miniroom = async (client: Client) =>
          readMiniRoomResult(new PacketReader(await takeKeeping(client, 0x50), 1));

        hero.game.send(
          encodeClientMiniRoomRequest({ kind: "invite", roomKind: 1, targetId: altId }),
        );
        const invitation = await miniroom(alt.game);
        expect(
          invitation.kind === "invite" &&
            invitation.inviterId === heroId &&
            invitation.inviterName === hero.character.stats.name,
          `Alt is asked to trade by "${invitation.kind === "invite" ? invitation.inviterName : invitation.kind}" (0x50 type 1)`,
        );
        const acknowledged = await miniroom(hero.game);
        expect(
          acknowledged.kind === "refused" && acknowledged.code === 0,
          `and the asker gets the silent code 0 (${acknowledged.kind}/${acknowledged.kind === "refused" ? acknowledged.code : acknowledged.kind})`,
        );

        alt.game.send(encodeClientMiniRoomRequest({ kind: "accept", inviterId: heroId }));
        const heroEnter = await miniroom(hero.game);
        const altEnter = await miniroom(alt.game);
        expect(
          heroEnter.kind === "enter" &&
            heroEnter.roomKind === 1 &&
            heroEnter.myIndex === 0 &&
            heroEnter.participants.map((p) => p.name).join(",") ===
              [hero.character.stats.name, alt.character.stats.name].join(","),
          `both windows open with both names (type 4, kind ${heroEnter.kind === "enter" ? heroEnter.roomKind : heroEnter.kind})`,
        );
        expect(
          altEnter.kind === "enter" && altEnter.myIndex === 1,
          `and each side is told which half is its own (myIndex ${altEnter.kind === "enter" ? altEnter.myIndex : "-"})`,
        );

        hero.game.send(encodeClientMiniRoomRequest({ kind: "offerMesos", amount: tradeMesos }));
        const heroOffer = await miniroom(hero.game);
        const altOffer = await miniroom(alt.game);
        expect(
          heroOffer.kind === "mesos" && heroOffer.amount === tradeMesos && heroOffer.index === 0,
          `Hero puts ${tradeMesos} mesos on the table (type 12)`,
        );
        expect(
          altOffer.kind === "mesos" && altOffer.amount === tradeMesos,
          "and the other window shows the same number",
        );

        hero.game.send(encodeClientMiniRoomRequest({ kind: "confirm" }));
        alt.game.send(encodeClientMiniRoomRequest({ kind: "confirm" }));
        const heroLock = await miniroom(hero.game);
        const altLock = await miniroom(alt.game);
        expect(
          heroLock.kind === "lock" && altLock.kind === "lock",
          "both sides see the lock (0x50 type 13)",
        );
        const heroPaid = readStatUpdate(
          new PacketReader(await takeKeeping(hero.game, 0x0d), 1),
        ).diff;
        const altPaid = readStatUpdate(new PacketReader(await takeKeeping(alt.game, 0x0d), 1)).diff;
        expect(
          heroPaid.mesos === revived.stats.mesos - tradeMesos,
          `Hero's wallet really went down (0x0D mesos ${heroPaid.mesos})`,
        );
        expect(
          altPaid.mesos === altBefore + tradeMesos,
          `and Alt's went up by exactly that (0x0D mesos ${altPaid.mesos}, was ${altBefore})`,
        );
        expect(heroPaid.mesos !== undefined, "Trade response carries the wallet diff");
        heroWallet = heroPaid.mesos;
        const heroDone = await miniroom(hero.game);
        const altDone = await miniroom(alt.game);
        expect(
          heroDone.kind === "finish" &&
            heroDone.code === 3 &&
            altDone.kind === "finish" &&
            altDone.code === 3,
          `and both windows close as 교환이 성사되었습니다 (type 8 code ${heroDone.kind === "finish" ? heroDone.code : heroDone.kind})`,
        );
      }

      // --- a messenger room: 0x24 out, 0x4d back (FINDINGS §4.41) ------------------------------------
      // A 2003 "messenger" is a three-seat chat room, not a friend list: the window prints
      // "초대 : /초대 캐릭터이름" and "종료 : /q", and every member is one `0x4d` type 0 packet
      // `[room][slot][characterId][look…0][name][announce]`. The invitation is the same room id the
      // window was opened with, handed out by `0x4d` type 3 and echoed back by the client's "yes".
      //
      // The three packets that matter for the round trip are: the room (`type 0`, announce=1),
      // the invite answer (`type 4`, name first then the flag) and the chat line (`type 5`, already
      // formatted "name : text" because the client splits on " : ").
      const messenger = async (client: Client) =>
        readMessengerResult(
          new PacketReader(await takeKeeping(client, MESSENGER_OPCODE.result), 1),
        );

      hero.game.send(encodeClientMessengerRequest({ kind: "enter", roomId: 0 }));
      const opened = await messenger(hero.game);
      expect(
        opened.kind === "participant" &&
          opened.participant.slot === 0 &&
          opened.participant.name === hero.character.stats.name &&
          opened.participant.face === heroLook.appearanceA &&
          opened.announce,
        `Hero opens a room and sits in slot 0 (0x4d type 0, announce)`,
      );

      hero.game.send(
        encodeClientMessengerRequest({
          kind: "command",
          text: "/invite " + alt.character.stats.name,
        }),
      );
      const inviteSent = await messenger(hero.game);
      expect(
        inviteSent.kind === "inviteResult" &&
          inviteSent.ok === 1 &&
          inviteSent.name === alt.character.stats.name,
        `the inviter is told it was sent (type 4: name then the flag)`,
      );
      const asked = await messenger(alt.game);
      expect(
        asked.kind === "invite" &&
          asked.inviterName === hero.character.stats.name &&
          asked.roomId > 0,
        `and Alt is asked to join room ${asked.kind === "invite" ? asked.roomId : asked.kind} (type 3)`,
      );

      alt.game.send(encodeClientMessengerRequest({ kind: "enter", roomId: asked.roomId }));
      const heroSeesHero = await messenger(hero.game);
      const heroSeesAlt = await messenger(hero.game);
      const altSeesHero = await messenger(alt.game);
      const altSeesAlt = await messenger(alt.game);
      expect(
        heroSeesAlt.kind === "participant" &&
          heroSeesAlt.participant.slot === 1 &&
          heroSeesAlt.announce,
        "Hero is told Alt took slot 1 (and only that entry is announced)",
      );
      expect(
        heroSeesHero.kind === "participant" &&
          !heroSeesHero.announce &&
          altSeesHero.kind === "participant" &&
          altSeesHero.participant.slot === 0 &&
          altSeesAlt.kind === "participant" &&
          altSeesAlt.participant.slot === 1 &&
          altSeesAlt.participant.name === alt.character.stats.name &&
          altSeesAlt.announce,
        "both windows hold both entries, and Alt's own is the announced one",
      );

      // The window prints the line itself before sending it (`sub_4DE490` → `sub_4DEE50`, then the
      // packet), so what the server relays is already "name : text" and only the *other* window gets it.
      hero.game.send(
        encodeClientMessengerRequest({
          kind: "chat",
          line: `${hero.character.stats.name} : hello`,
        }),
      );
      const altLine = await messenger(alt.game);
      expect(
        altLine.kind === "chat" && altLine.line === `${hero.character.stats.name} : hello`,
        `the other window gets the line already formatted ("${altLine.kind === "chat" ? altLine.line : altLine.kind}")`,
      );
      // Look at the queue without draining it: the sections below own the packets that are still in it.
      expect(
        hero.game.pendingCount(MESSENGER_OPCODE.result) === 0,
        "and the speaker's own window does not get it back",
      );

      alt.game.send(encodeClientMessengerRequest({ kind: "leave" }));
      const emptied = await messenger(hero.game);
      expect(
        emptied.kind === "left" && emptied.slot === 1,
        "and leaving names the slot that emptied (type 2)",
      );

      hero.game.send(encodeClientMessengerRequest({ kind: "leave" }));
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
    const poolIds = new Map<number, number>();
    for (const packet of town) {
      if (packet[0] !== NPC_OPCODE.enterField) continue;
      const npc = readNpcEnterField(new PacketReader(packet, 1), false);
      if (npc.templateId !== undefined) poolIds.set(npc.templateId, npc.npcId);
    }
    const mai = poolIds.get(12100);
    // Only a claim about the town: on a second run against the same save Hero revives in 헤네시스 (above),
    // which has no 마이, and the note below is the honest answer instead of a failure.
    expect(
      mai !== undefined || revivedMap !== 1010000,
      `the town burst names 마이 (12100), with the pool id a click needs (${mai})`,
    );
    const wallet = heroWallet;
    if (mai === undefined) {
      console.log("  ..   no 마이 to click; the buying half of this section cannot run");
    } else if (wallet < 90) {
      console.log(
        `  ..   Hero has ${wallet} mesos - start the server with --start-mesos 200 on a fresh save`,
      );
    } else {
      // Clicking the NPC: what `sub_55AF20` sends is the pool id, and the answer is the release gate
      // (`0x19`, empty) followed by the window (`0x4A`).
      hero.game.send(encodeClientObjectClick({ objectId: mai }));
      await hero.game.take(0x19);
      const shop = readShopOpen(new PacketReader(await hero.game.take(SHOP_OPEN_OPCODE), 1));
      expect(shop.shopId === 12100, `마이's shop is keyed by the NPC template id (${shop.shopId})`);
      const row = shop.items.findIndex((line) => line.itemId === 2030004);
      const price = row < 0 ? undefined : shop.items[row].price;
      expect(
        price === 90,
        `and 헤네시스 귀환 주문서 is on sale for the archive's own price (${price})`,
      );

      hero.game.send(encodeClientShopRequest({ kind: "buy", row, itemId: 2030004, count: 1 }));
      const bought = await hero.game.take(SHOP_RESULT_OPCODE);
      expect(
        bought[1] === SHOP_RESULT.silent,
        "the purchase answers 0x4B silent (a trade says nothing)",
      );
      const put = readInventoryChange(new PacketReader(await hero.game.take(INVENTORY_OPCODE), 1))
        .changes[0];
      expect(
        put?.op === INVENTORY_OP.put && put.item.itemId === 2030004,
        "0x0B puts the scroll in the USE tab",
      );
      const paid = readStatUpdate(new PacketReader(await hero.game.take(0x0d), 1)).diff;
      expect(paid.mesos === wallet - 90, `and the wallet went ${wallet} -> ${paid.mesos}`);

      // The use itself: `[0x19][slot][itemId]` - the same two fields `0x18` carries, with the item id
      // deciding the family. `0x0B` takes it out of the slot and `0x16` carries the new map, whose id is
      // the one the item's own `spec/moveTo` names, not anything the server chose.
      const slot = put.slot;
      hero.game.send(
        encodeClientUseItem({ slot, itemId: 2030004 }, CLIENT_FIELD_OPCODE.useMapItem),
      );
      const used = readInventoryChange(new PacketReader(await hero.game.take(INVENTORY_OPCODE), 1))
        .changes[0];
      expect(used?.op === INVENTORY_OP.clear, "using the scroll takes it out of the slot");
      const landed = mapIdOfSetField(await hero.game.take(0x16));
      expect(landed === 100000000, `and 0x16 really lands in 헤네시스 (100000000), got ${landed}`);
    }

    console.log(`\nAll ${checks} native probe assertions passed.`);
    return { checks };
  } finally {
    for (const client of clients) client.close();
  }
}

if (import.meta.main) {
  await runWhisperProbe(nativeProbeOptions(process.argv.slice(2), process.env));
}
