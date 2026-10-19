/** Attach bridge tests never claim a character, use a login protocol or write a save. */
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { attachedWebOptions } from "../attach-web.ts";
import { startWebClient } from "../../server/src/net/webclient.ts";
const args = ["--port", "0", "--login-port", "8484", "--game-port", "8485", "--data", "off"];
test("attach validates explicit ports/unknown flags before opening assets; no game/admin/save configuration", () => {
  const options = attachedWebOptions(args);
  assert.deepEqual(options, {
    partyInviteIdentity: false,
    port: 0,
    loginPort: 8484,
    gamePort: 8485,
    host: "127.0.0.1",
    gameHost: "127.0.0.1",
  });
  for (const name of ["--port", "--login-port", "--game-port"]) {
    for (const bad of ["-1", "1.5", "65536", "NaN", ""]) {
      const changed = [...args];
      changed.splice(changed.indexOf(name), 2, `${name}=${bad}`);
      assert.throws(() => attachedWebOptions(changed), /integer port/);
    }
  }
  assert.throws(() => attachedWebOptions(["--data", "off"]), /--port/);
  assert.throws(() => attachedWebOptions([...args, "--save", "progress.json"]), /Unknown option/);
  assert.throws(() => attachedWebOptions([...args, "--account", "new:pass"]), /Unknown option/);
});
test("attach exposes real archive art/map/items/skills/audio without creating a world", () => {
  const archiveArgs = [...args];
  archiveArgs[archiveArgs.indexOf("off")] = "Data.wz";
  const options = attachedWebOptions(archiveArgs);
  assert.ok(options.art?.reader?.at("UI/UIWindow.img/ContextMenu/3"));
  assert.ok(
    options.mapProvider &&
      options.mapCatalog &&
      options.itemCatalog &&
      options.skills &&
      options.audio,
  );
  assert.equal(options.partyInviteIdentity, false);
  assert.equal(options.testTools, undefined);
  assert.equal(options.mobPresentation, undefined);
});
test("closing independent HTTP bridge leaves native listeners intact; read-only title/module GETs cause0TCP connections", async (t) => {
  let connections = 0;
  const native = net.createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => native.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => native.close(() => resolve())));
  const address = native.address();
  assert.ok(address && typeof address !== "string");
  const options = attachedWebOptions([
    "--port",
    "0",
    "--login-port",
    String(address.port),
    "--game-port",
    String(address.port),
    "--data",
    "off",
  ]);
  const web = await startWebClient(options);
  try {
    for (const path of ["/", "/main.js", "/player-menu.ts", "/fame.ts", "/party.ts"]) {
      const response = await fetch(`http://127.0.0.1:${web.port}${path}`);
      assert.equal(response.status, 200);
      assert.ok((await response.text()).length > 0);
    }
  } finally {
    await web.close();
  }
  assert.equal(native.listening, true);
  assert.equal(connections, 0);
});
