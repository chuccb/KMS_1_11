import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { ProbeSession } from "../scripts/probe-session.ts";
import { nativeProbeOptions, browserProbeOptions } from "../scripts/probe-options.ts";
import { sampleStats } from "../scripts/browser_render_probe.ts";
import { CipherState, CLIENT_SEND_MAGIC } from "../src/protocol/cipher.ts";
import {
  encodeHandshake,
  encodeSessionPacket,
  HANDSHAKE_BODY_BYTES,
  SessionDeframer,
} from "../src/protocol/session.ts";

async function peer(
  run: (port: number, received: Uint8Array[], write: (packet: Uint8Array) => void) => Promise<void>,
  handshake = true,
) {
  // Fake framing peer only: no login/world service, WZ/account/save store, or character packets.
  const sockets = new Set<Socket>(),
    received: Uint8Array[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    const deframer = new SessionDeframer({
      recvState: new CipherState(123),
      expectedMagic: CLIENT_SEND_MAGIC,
      expectHandshake: false,
    });
    socket.on("data", (chunk: Buffer) => {
      for (const event of deframer.push(chunk))
        if (event.kind === "packet") received.push(event.plain);
    });
    if (handshake) socket.write(encodeHandshake(new Uint8Array(HANDSHAKE_BODY_BYTES), 123, 456));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const sendState = new CipherState(456);
  try {
    await run(address.port, received, (packet) => {
      for (const socket of sockets) socket.write(encodeSessionPacket(packet, sendState, "s2c"));
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("typed probe transport obeys handshake seeds and preserves unmatched packet order", async () => {
  await peer(async (port, received, write) => {
    const client = await ProbeSession.connect(port);
    try {
      write(Uint8Array.of(0x60, 1));
      write(Uint8Array.of(0x61, 2));
      write(Uint8Array.of(0x62, 3));
      assert.deepEqual(await client.take(0x61), Uint8Array.of(0x61, 2));
      assert.deepEqual(await client.take(0x60), Uint8Array.of(0x60, 1));
      assert.deepEqual(await client.take(0x62), Uint8Array.of(0x62, 3));
      client.send(Uint8Array.of(0x70, 5));
      for (let i = 0; i < 100 && !received.length; i++) await delay(5);
      assert.deepEqual(received, [Uint8Array.of(0x70, 5)]);
    } finally {
      client.close();
    }
  });
});

test("probe packet timeouts release consumer ownership; concurrent reads and use after close fail explicitly", async () => {
  await peer(async (port, _received, write) => {
    const client = await ProbeSession.connect(port);
    try {
      const first = client.take(0x60, 30);
      await assert.rejects(client.take(0x61, 30), /Concurrent/);
      await assert.rejects(client.drain(0), /Concurrent/);
      await assert.rejects(first, /within 30ms/);
      write(Uint8Array.of(0x60, 1));
      assert.equal((await client.take(0x60))[1], 1);
      const draining = client.drain(25);
      await assert.rejects(client.take(0x62), /Concurrent/);
      await assert.rejects(client.drain(0), /Concurrent/);
      write(Uint8Array.of(0x62, 3));
      assert.deepEqual(await draining, [Uint8Array.of(0x62, 3)]);
      await assert.rejects(client.take(-1));
      await assert.rejects(client.take(0x100));
      await assert.rejects(client.take(0x60, Number.NaN));
      await assert.rejects(client.drain(-1));
    } finally {
      client.close();
    }
    assert.throws(() => client.send(Uint8Array.of(0)), /closed/);
    await assert.rejects(client.take(0x60), /closed/);
    client.close();
  });
});

test("probe handshake timeout closes its socket; invalid transport options cannot start a connection", async () => {
  await peer(async (port) => {
    await assert.rejects(ProbeSession.connect(port, 25), /handshake timed out/);
  }, false);
  for (const port of [0, -1, 65536, 1.5, Number.NaN])
    await assert.rejects(ProbeSession.connect(port), /Invalid probe port/);
  await assert.rejects(
    ProbeSession.connect(1, Number.POSITIVE_INFINITY),
    /Invalid handshake timeout/,
  );
});

const env = {
  PROBE_ACCOUNT: "fixture-one",
  PROBE_PASSWORD: "fixture-only",
  PROBE_ALT_ACCOUNT: "fixture-two",
  PROBE_ALT_PASSWORD: "fixture-only",
};
test("state-changing probes require explicit targets, acknowledgement and distinct accounts, never default credentials", () => {
  const args = ["8596", "8597", "--allow-state-changes"];
  assert.deepEqual(nativeProbeOptions(args, env), {
    loginPort: 8596,
    gamePort: 8597,
    account: { user: "fixture-one", password: "fixture-only" },
    other: { user: "fixture-two", password: "fixture-only" },
  });
  for (const bad of [
    [],
    ["8596", "8597"],
    [...args, "extra"],
    ["--unknown", "8597", "--allow-state-changes"],
    ["8596", "8596", "--allow-state-changes"],
    ["8516", "8597", "--allow-state-changes"],
    ["8596", "8517", "--allow-state-changes"],
  ])
    assert.throws(() => nativeProbeOptions(bad, env));
  assert.throws(() => nativeProbeOptions(args, {}), /Set PROBE_ACCOUNT/);
  assert.throws(
    () => nativeProbeOptions(args, { ...env, PROBE_PASSWORD: undefined }),
    /Set PROBE_PASSWORD/,
  );
  assert.throws(
    () => nativeProbeOptions(args, { ...env, PROBE_ALT_ACCOUNT: env.PROBE_ACCOUNT }),
    /distinct/,
  );
  assert.throws(() => nativeProbeOptions([...args, "--allow-state-changes"], env));
});

test("manual browser probes reject known live ports/proxy hosts, URL credentials and absent accounts", () => {
  assert.equal(
    browserProbeOptions(["8595", "--allow-state-changes"], env).origin,
    "http://127.0.0.1:8595",
  );
  for (const target of [
    "8515",
    "http://localhost:8516",
    "https://8515-example.e2b.app",
    "https://8517-example.e2b.app",
    "https://user:pass@fixture/",
    "http://fixture/path",
  ])
    assert.throws(() => browserProbeOptions([target, "--allow-state-changes"], env));
  assert.throws(() => browserProbeOptions(["8595"], env));
  assert.throws(() => browserProbeOptions(["8595", "--allow-state-changes"], {}));
});

test("render statistics retain median/p95 definition and reject invalid/empty input", () => {
  const samples = Array.from({ length: 120 }, (_, i) => ({ cpu: i, interval: i, draws: i }));
  assert.deepEqual(sampleStats(samples, "cpu"), { median: 60, p95: 114, mean: 59.5 });
  assert.deepEqual(sampleStats([{ cpu: 1, interval: 2, draws: 3 }], "draws"), {
    median: 3,
    p95: 3,
    mean: 3,
  });
  assert.throws(() => sampleStats([], "cpu"));
  assert.throws(() => sampleStats([{ cpu: Number.NaN, interval: 1, draws: 1 }], "cpu"));
  assert.throws(() => sampleStats([{ cpu: 1, interval: -1, draws: 1 }], "interval"));
});

test("tool/component imports are inert in a separate process even with networking and browser launch denied", async () => {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dirname}/helpers/probe-import-safety.ts`],
    {
      cwd: `${import.meta.dirname}/../..`,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10000,
    },
  );
  const [status, output, errors] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(status, 0, errors);
  assert.equal(errors, "");
  assert.deepEqual(JSON.parse(output), { imported: 41, attempts: 0 });
});

test("native smoke creation fixture uses actual male MakeCharInfo choices, native dice and valid CP949 names", async () => {
  const { WHISPER_FIXTURE } = await import("../scripts/whisper_probe.ts");
  const { WzArchive } = await import("../src/wz/archive.ts");
  const { artReaderOf } = await import("../src/game/wzart.ts");
  const { creationCatalogOf, validateCreationLook, validCreationName } =
    await import("../src/game/creation.ts");
  const catalog = creationCatalogOf(
    artReaderOf(WzArchive.open(`${import.meta.dirname}/../../Data.wz`)),
  );
  assert.ok(catalog);
  assert.deepEqual(validateCreationLook(WHISPER_FIXTURE.look, catalog, 0), [
    ...WHISPER_FIXTURE.look,
  ]);
  assert.ok(validCreationName(WHISPER_FIXTURE.hero, catalog.forbidden));
  assert.ok(validCreationName(WHISPER_FIXTURE.alt, catalog.forbidden));
});

test("filtered probe drain preserves unrelated packets and pending snapshots do not expose mutable queue ownership", async () => {
  await peer(async (port, _received, write) => {
    const client = await ProbeSession.connect(port);
    try {
      write(Uint8Array.of(0x60, 1));
      write(Uint8Array.of(0x61, 2));
      write(Uint8Array.of(0x62, 3));
      write(Uint8Array.of(0x61, 4));
      assert.deepEqual(await client.drain(30, 0x61), [
        Uint8Array.of(0x61, 2),
        Uint8Array.of(0x61, 4),
      ]);
      assert.equal(client.pendingCount(0x60), 1);
      assert.equal(client.pendingCount(0x61), 0);
      assert.deepEqual(await client.drain(0), [Uint8Array.of(0x60, 1), Uint8Array.of(0x62, 3)]);
      assert.throws(() => client.pendingCount(256), /Invalid opcode/);
      await assert.rejects(client.drain(0, -1), /Invalid opcode/);
    } finally {
      client.close();
    }
    assert.throws(() => client.pendingCount(0x60), /closed/);
    await assert.rejects(client.drain(0), /closed/);
  });
});
