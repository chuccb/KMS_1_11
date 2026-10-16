/**
 * The whole login chain, played end to end by a fake client.
 *
 * This is the closest thing to an oracle we can run without the 2003 binary: the "client" half of
 * this test parses every server reply in exactly the order recorded in docs/protocol/FINDINGS.md
 * 4.8/4.9, over a real ciphered session (handshake -> framed packets). If an encoder and the
 * documented client read order ever drift apart, this test fails.
 *
 * The chain is:
 *   server -> handshake(211)            - seeds both directions
 *   client -> 0x01 login(id, pw)
 *   server -> 0x01 result + world list  - client switches to CWorldSelect
 *   client -> 0x02 world index
 *   server -> 0x02 result + 3 slots     - client switches to CCharSelect
 *   client -> 0x03 characterId
 *   server -> 0x03 ip, port, charId     - client connects to the game server
 *   client -> 0x04 charId               - on the new connection, right after the handshake
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CipherState, SERVER_SEND_MAGIC, CLIENT_SEND_MAGIC } from "../src/protocol/cipher.ts";
import { encodeHandshake, encodeSessionPacket, SessionDeframer, type SessionEvent } from "../src/protocol/session.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { characterDataOf, readCharacterData } from "../src/protocol/chardata.ts";
import {
  LOGIN_OPCODE,
  LOGIN_RESULT,
  encodeLoginResult,
  encodeSelectCharacterResult,
  encodeWorldSelectResult,
  ipv4WireValue,
} from "../src/protocol/replies.ts";
import { decodeClientPacket, encodeClientPacket, describeClientPacket } from "../src/protocol/login.ts";

const CLIENT_SEND_SEED = 0x1234abcd;
const CLIENT_RECV_SEED = 0x0badc0de;

/** The client half: a deframer that expects server packets, plus the moves it makes. */
class FakeClient {
  readonly deframer = new SessionDeframer({ expectedMagic: SERVER_SEND_MAGIC });
  readonly seen: SessionEvent[] = [];

  /** Feeds raw bytes from the server and returns the plain bodies that arrived. */
  receive(bytes: Uint8Array): Uint8Array[] {
    const events = this.deframer.push(bytes);
    this.seen.push(...events);
    return events.filter((event) => event.kind === "packet").map((event) => (event as { plain: Uint8Array }).plain);
  }

  /** Asserts every packet so far carried the header the cipher state predicted. */
  assertHeadersOk(): void {
    for (const event of this.seen) {
      if (event.kind !== "packet") continue;
      assert.equal(event.headerOk, true, `header mismatch: got 0x${event.header.toString(16)}`);
    }
  }
}

test("the login chain works end to end over a real encrypted session", () => {
  const handshake = encodeHandshake(new Uint8Array(199), CLIENT_SEND_SEED, CLIENT_RECV_SEED);
  const serverSendState = new CipherState(CLIENT_RECV_SEED);
  const client = new FakeClient();
  client.receive(handshake);

  // --- 0x01: the client asks to log in, the server answers with the world list.
  const loginRequest = encodeClientPacket({ kind: "login-request", opcode: 0x01, username: "admin", password: "hunter2" });
  assert.deepEqual(decodeClientPacket(loginRequest), {
    kind: "login-request",
    opcode: 0x01,
    username: "admin",
    password: "hunter2",
  });

  client.receive(
    encodeSessionPacket(
      encodeLoginResult(LOGIN_RESULT.ok, {
        account: { app4: 42, app8: 1, app9: 0 },
        worlds: [{ name: "Scania", unknownId: 0 }],
      }),
      serverSendState,
    ),
  );
  client.assertHeadersOk();
  const loginReply = client.receive(new Uint8Array(0)); // drained above; keep the flow explicit
  assert.equal(loginReply.length, 0);

  // The client parses the reply in the order of sub_4D0DB0.
  const last = client.seen.at(-1);
  if (!last || last.kind !== "packet") throw new Error("no login reply");
  const reader = new PacketReader(last.plain);
  assert.equal(reader.readByte(), LOGIN_OPCODE.login);
  assert.equal(reader.readByte(), LOGIN_RESULT.ok);
  assert.equal(reader.readU32(), 42);
  assert.equal(reader.readByte(), 1);
  assert.equal(reader.readByte(), 0);
  const worldCount = reader.readByte();
  assert.equal(worldCount, 1);
  assert.equal(reader.readAsciiString(), "Scania");
  assert.equal(reader.readU32(), 0);
  assert.equal(reader.exhausted, true);

  // --- 0x02: world select -> the three character slots (the client only fills what it is given).
  const worldSelect = encodeClientPacket({ kind: "world-select", opcode: 0x02, worldId: 0 });
  assert.deepEqual(decodeClientPacket(worldSelect), { kind: "world-select", opcode: 0x02, worldId: 0 });

  const hero = characterDataOf({ id: 0x1000, name: "Hero", level: 12, job: 0, str: 5, dex: 5, int: 5, luk: 5, hp: 50, maxHp: 50 });
  client.receive(encodeSessionPacket(encodeWorldSelectResult(LOGIN_RESULT.ok, [hero]), serverSendState));

  const worldReply = client.seen.at(-1);
  if (!worldReply || worldReply.kind !== "packet") throw new Error("no world reply");
  const worldReader = new PacketReader(worldReply.plain);
  assert.equal(worldReader.readByte(), LOGIN_OPCODE.worldSelect);
  assert.equal(worldReader.readByte(), LOGIN_RESULT.ok);
  assert.equal(worldReader.readByte(), 1, "one character in the list");
  const received = readCharacterData(worldReader);
  assert.deepEqual(received.stats, hero.stats);
  assert.equal(worldReader.exhausted, true);

  // --- 0x03: select the character -> the client is handed the game server address plus its id.
  const select = encodeClientPacket({ kind: "select-character", opcode: 0x03, characterId: 0x1000 });
  assert.deepEqual(decodeClientPacket(select), { kind: "select-character", opcode: 0x03, characterId: 0x1000 });

  const characterId = 0x1000;
  client.receive(
    encodeSessionPacket(
      encodeSelectCharacterResult(LOGIN_RESULT.ok, { ip: "127.0.0.1", port: 0x8484, characterId }),
      serverSendState,
    ),
  );
  client.assertHeadersOk();

  const selectReply = client.seen.at(-1);
  if (!selectReply || selectReply.kind !== "packet") throw new Error("no select-character reply");
  const selectReader = new PacketReader(selectReply.plain);
  assert.equal(selectReader.readByte(), LOGIN_OPCODE.selectCharacter);
  assert.equal(selectReader.readByte(), LOGIN_RESULT.ok);
  // The client copies those four bytes straight into sockaddr_in.sin_addr, so they are 7F 00 00 01.
  assert.equal(selectReader.readU32(), ipv4WireValue("127.0.0.1"));
  assert.equal(selectReader.readU16(), 0x8484);
  const receivedId = selectReader.readU32();
  assert.equal(receivedId, characterId);
  assert.equal(selectReader.exhausted, true);

  // --- The new connection: handshake again, then the client identifies itself with its id.
  const gameServerHandshake = encodeHandshake(new Uint8Array(199), CLIENT_SEND_SEED, CLIENT_RECV_SEED);
  const gameServerRecvState = new CipherState(CLIENT_SEND_SEED);
  const gameServer = new SessionDeframer({ recvState: gameServerRecvState, expectHandshake: false, expectedMagic: CLIENT_SEND_MAGIC });
  const idEcho = encodeClientPacket({ kind: "handshake-reply", opcode: 0x04, value: receivedId });
  const echoed = gameServer.push(encodeSessionPacket(idEcho, new CipherState(CLIENT_SEND_SEED), "c2s"));
  assert.equal(gameServerHandshake.length, 211);
  const firstPacket = echoed.find((event) => event.kind === "packet");
  if (!firstPacket || firstPacket.kind !== "packet") throw new Error("the id echo did not arrive");
  assert.equal(firstPacket.headerOk, true);
  assert.deepEqual(decodeClientPacket(firstPacket.plain), { kind: "handshake-reply", opcode: 0x04, value: characterId });
  assert.equal(describeClientPacket(firstPacket.plain), `handshake-reply value=0x${characterId.toString(16)}`);
});

test("every login-chain opcode is labelled in a trace, none are silently dropped", () => {
  const packets = [
    { kind: "select-character", opcode: 0x03, characterId: 1 },
    { kind: "create-character", opcode: 0x05, name: "Newbie" },
    { kind: "check-name", opcode: 0x06, name: "Newbie", appearance: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { kind: "delete-character", opcode: 0x07, characterId: 1 },
  ] as const;
  for (const packet of packets) {
    const text = describeClientPacket(encodeClientPacket(packet));
    assert.ok(text && text.length > 0, `${packet.kind} has no description`);
  }
});
