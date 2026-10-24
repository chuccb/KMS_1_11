/** Encrypted loopback synthetic field peer: NOT LoginServer/GameEntryServer/LIVE/account/save. */
import net from "node:net";
import assert from "node:assert/strict";
import { ClientSession, type ClientEvent } from "../../src/client/session.ts";
import { CipherState } from "../../src/protocol/cipher.ts";
import {
  SessionDeframer,
  encodeHandshake,
  encodeSessionPacket,
  DEFAULT_HANDSHAKE_BODY_BYTES,
} from "../../src/protocol/session.ts";
import { characterDataOf } from "../../src/protocol/chardata.ts";
import { encodeSetField, encodeUserEnterField } from "../../src/protocol/field.ts";
import { encodeSystemNotice } from "../../src/protocol/notice.ts";
import { encodeCp949 } from "../../src/protocol/cp949.ts";
export const byteName = (text: string) => Buffer.from(encodeCp949(text)).toString("latin1");
export async function syntheticSocialPeer(t: { after(fn: () => void | Promise<void>): void }) {
  const character = characterDataOf({
    id: 91,
    name: byteName("자기이름"),
    level: 20,
    job: 0,
    str: 8,
    dex: 6,
    int: 6,
    luk: 5,
    hp: 50,
    maxHp: 50,
    mp: 50,
    maxMp: 50,
    ap: 3,
    mapId: 1000000,
  });
  const field = () =>
    encodeSetField({
      mode: 0,
      full: true,
      randomSeedA: 1,
      randomSeedB: 2,
      randomSeedC: 3,
      character,
    });
  const sockets = new Set<net.Socket>(),
    packets: Uint8Array[] = [],
    events: ClientEvent[] = [];
  let peer: net.Socket | undefined,
    n = 0;
  const state = new CipherState(0x22222222);
  const send = (...plain: Uint8Array[]) => {
    assert.ok(peer);
    peer.write(Buffer.concat(plain.map((p) => encodeSessionPacket(p, state, "s2c"))));
  };
  const server = net.createServer((socket) => {
    peer = socket;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const recv = new SessionDeframer({ recvState: new CipherState(0x11111111) });
    socket.write(
      encodeHandshake(new Uint8Array(DEFAULT_HANDSHAKE_BODY_BYTES), 0x11111111, 0x22222222),
    );
    socket.on("data", (chunk) => {
      for (const p of recv.push(
        new Uint8Array(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
      )) {
        if (p.kind !== "packet") continue;
        assert.equal(p.headerOk, true);
        packets.push(p.plain);
        if (p.opcode === 0x04)
          send(
            field(),
            encodeUserEnterField({
              characterId: 7,
              name: byteName("상대이름"),
              unknown64: 0,
              face: 20000,
              unknownA: 0,
              unknownB: 0,
              avatarItems: [],
              x: 100,
              y: 100,
              action: 6,
              foothold: 1,
            }),
          );
        else if (p.opcode === 0x12) send(encodeSystemNotice(encodeCp949(String(++n))));
      }
      assert.equal(recv.failure, undefined);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const session = new ClientSession({ loginPort: 0 });
  session.onEvent((e) => events.push(e));
  t.after(async () => {
    session.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const wait = (predicate: (event: ClientEvent) => boolean) =>
    new Promise<ClientEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(Error("synthetic peer timeout"));
      }, 3000);
      const off = session.onEvent((e) => {
        if (predicate(e)) {
          clearTimeout(timer);
          off();
          resolve(e);
        }
      });
    });
  const barrier = async () => {
    const next = String(n + 1),
      done = wait((e) => e.kind === "system-notice" && e.text === next);
    await session.say(new Uint8Array());
    await done;
  };
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await session.enterGame({ result: 0, ip: "127.0.0.1", port: address.port, characterId: 91 });
  await barrier();
  return { session, packets, events, send, wait, barrier, field };
}
