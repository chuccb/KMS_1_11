/**
 * Live playthrough over the browser protocol, on a running `serve`: the whole loop the page drives,
 * with no browser and no DOM.
 *
 * The character starts in 헤네시스 (or wherever the save left it), walks through `west00` into the
 * hunting ground, swings at the first monster it sees until the monster dies, then walks onto the
 * drop and waits for the field's pickup. What it prints is what the page would be told at every
 * step: `hit`, `mob-die`, `drop-enter`, `drop-leave` (taken), `loot`, `inventory`.
 *
 *   node server/scripts/play_probe.mjs <webPort>        (default 8495)
 *
 * The account needs a character in 100000000 with something worn (the starter sword is enough -
 * `server/src/cli.ts serve --account admin:admin --save ... --start-mesos 200` plus a first login
 * gives it one). It leaves the character where it fought and the socket closed, so it can be run
 * again: the second run starts in the hunting ground and skips the portal.
 */
// Live playthrough over the browser protocol on the real save: Henesys -> west00 -> the hunting
// ground -> Ctrl swings until something dies -> the drop -> walk onto it -> the loot line.
const PORT = process.argv[2] ?? "8495";
const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const seen = [];
socket.addEventListener("message", (event) => seen.push(JSON.parse(String(event.data))));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (match, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) {
    const found = seen.findLast(match);
    if (found) return found;
    if (Date.now() > end) throw new Error(`timeout; have ${[...new Set(seen.map((m) => m.t))].join(",")}`);
    await tick(50);
  }
};
const send = (m) => socket.send(JSON.stringify(m));
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("socket error")), { once: true });
});
send({ t: "login", user: "admin", password: "admin" });
await waitFor((m) => m.t === "login");
send({ t: "world", index: 0 });
const characters = await waitFor((m) => m.t === "characters");
const hero = characters.characters.find((c) => c.name === "Hero") ?? characters.characters[0];
send({ t: "character", id: hero.id });
let field = await waitFor((m) => m.t === "field");
console.log("field", field.mapId);
if (field.mapId === 100000000) {
  send({ t: "portal", name: "west00" });
  field = await waitFor((m) => m.t === "field" && m.mapId !== 100000000);
  console.log("portal -> field", field.mapId);
}
const mob = (await waitFor((m) => m.t === "mob-enter")).mob;
console.log("target", mob.mobId, "template", mob.templateId, "at", mob.x, mob.y);
let swings = 0;
for (let i = 0; i < 40; i++) {
  send({ t: "attack", mobId: mob.mobId, facingLeft: false });
  swings++;
  await waitFor((m) => m.t === "hit" && m.mobId === mob.mobId, 4000);
  if (seen.some((m) => m.t === "mob-die" && m.mobId === mob.mobId)) break;
  await tick(120);
}
console.log("swings:", swings, "died:", seen.some((m) => m.t === "mob-die" && m.mobId === mob.mobId));
const drop = (await waitFor((m) => m.t === "drop-enter")).drop;
console.log("drop", JSON.stringify(drop));
send({ t: "move", x: drop.x, y: drop.y, foothold: 0 });
const picked = await waitFor((m) => m.t === "drop-leave" && m.dropId === drop.dropId, 10000);
console.log("picked", JSON.stringify(picked));
const loot = await waitFor((m) => m.t === "loot", 6000);
console.log("loot", JSON.stringify(loot));
const inv = await waitFor((m) => m.t === "inventory", 6000);
console.log("inventory tabs:", inv.inventory.tabs.map((t) => `${t.tab}:${t.items.length}`).join(" "));
socket.close();
process.exit(0);
