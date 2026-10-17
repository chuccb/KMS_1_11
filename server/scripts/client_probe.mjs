// Offline DOM/canvas shim: does client/main.js run, and do its handlers survive real event shapes?
class El {
  constructor(tag = "div") {
    this.tag = tag; this.children = []; this.style = {}; this.value = ""; this.textContent = "";
    this.placeholder = ""; this.scrollTop = 0; this.scrollHeight = 0; this.className = "";
    this.dataset = {}; this.src = ""; this.alt = ""; this.title = ""; this.type = "";
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const want = force === undefined ? !classes.has(name) : force;
        if (want) classes.add(name);
        else classes.delete(name);
        return want;
      },
    };
  }
  addEventListener(type, fn) { (this.listeners ??= {}); (this.listeners[type] ??= []).push(fn); }
  fire(type, event = {}) { event.preventDefault ??= () => {}; for (const fn of this.listeners?.[type] ?? []) fn(event); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  remove() {
    const parent = this.parent;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parent = undefined;
  }
  focus() {}
  blur() {}
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html ?? ""; }
  get firstElementChild() { return this.children[0] ?? null; }
  getContext() { return ctxStub; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
}
const canvasEl = new El("canvas");
let drawImageCalls = 0;
const ctxStub = new Proxy({}, {
  get(target, prop) {
    if (prop === "canvas") return canvasEl;
    if (prop === "drawImage") return () => { drawImageCalls += 1; };
    if (!(prop in target)) target[prop] = () => {};
    return target[prop];
  },
  set(target, prop, value) { target[prop] = value; return true; },
});
const elements = new Map();
globalThis.HTMLInputElement = El;
globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, id === "view" ? canvasEl : new El());
    return elements.get(id);
  },
  activeElement: null,
  createElement(tag) { return new El(tag); },
  createTextNode(text) { return { textContent: text }; },
};
const windowListeners = {};
globalThis.window = {
  devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
  addEventListener(type, fn) { (windowListeners[type] ??= []).push(fn); },
};
globalThis.performance = { now: () => Date.now() };
const storage = new Map();
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
let frameCallback;
globalThis.requestAnimationFrame = (fn) => { frameCallback = fn; return 1; };
globalThis.location = { protocol: "http:", host: "127.0.0.1:8500" };
// The picture stack: a canvas never finishes loading here, so the renderer must not need it.
globalThis.Image = class {
  constructor() { this._src = ""; this.width = 32; this.height = 32; this.naturalWidth = 32; this.naturalHeight = 32; this.onload = null; this.onerror = null; }
  set src(value) { this._src = value; setTimeout(() => this.onload?.(), 0); }
  get src() { return this._src; }
};
const STUB_MAP = {
  id: 1000000, name: "stub", streetName: "stub",
  portals: [
    { name: "sp", type: 0, x: -91, y: 181, toMapId: 999999999 },
    { name: "door", type: 2, x: 200, y: 181, toMapId: 1010000 },
  ],
  footholds: [{ id: 32, x1: 0, y1: 300, x2: 1000, y2: 300, next: 0, prev: 0 }],
  mobs: [], npcs: [],
};
const STUB_ART = {
  backs: [{ path: "Map/Back/x.img/back/0", ox: 128, oy: 128, x: 0, y: 0, rx: 0, ry: 0, type: 0, cx: 0, cy: 0, a: 255, front: 0, flip: 0 }],
  sprites: [{
    kind: "tile", layer: 0, x: 0, y: 0, z: -500, flip: 0,
    frames: [{ path: "Map/Tile/x.img/a/0", delay: 0, ox: 0, oy: 0 }],
  }],
  bounds: { left: 0, top: 0, right: 1000, bottom: 692 },
};
globalThis.fetch = async (url) => {
  const path = String(url);
  let body = STUB_MAP;
  if (path.endsWith("/art")) body = STUB_ART;
  else if (path.startsWith("/api/npc/")) body = { templateId: 2003, actions: { stand: [{ path: "Npc/0002003.img/stand/0", delay: 1000, ox: 20, oy: 40 }] } };
  else if (path.startsWith("/api/mob/")) body = { templateId: 1210100, actions: { move: [{ path: "Mob/0121010.img/move/0", delay: 180, ox: 20, oy: 40 }] } };
  return { ok: true, status: 200, json: async () => body };
};
const sent = [];
const sockets = [];
globalThis.WebSocket = class {
  static OPEN = 1;
  constructor() { this.readyState = 1; this.listeners = {}; sockets.push(this); setTimeout(() => this.emit("open"), 0); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  emit(type, event = {}) { for (const fn of this.listeners[type] ?? []) fn(event); }
  send(text) { sent.push(JSON.parse(text)); }
  close() {}
  push(message) { this.emit("message", { data: JSON.stringify(message) }); }
};
const intervals = [];
globalThis.setInterval = (fn) => { intervals.push(fn); return intervals.length; };

const { readFileSync } = await import("node:fs");
const { runInThisContext } = await import("node:vm");
runInThisContext(readFileSync(new URL("../../client/main.js", import.meta.url), "utf8") + `
;globalThis.clientProbe = {
  shopRowsOf, shopScrollbarGeometry, shopWindowAt, itemTooltipLines,
  get scroll() { return { ...shopScroll }; },
  get shopPosition() { return { ...shopAt }; },
  get picked() { return shopSellPick; },
  get dragging() { return shopDrag !== undefined || shopScrollDrag !== undefined; },
  get pressed() { return shopPressed; },
  setFacts(id, facts) { itemInfo.set(id, facts); },
};`, { filename: "client/main.js" });
await new Promise((r) => setTimeout(r, 10));
elements.get("user").value = "admin";
elements.get("pass").value = "admin";
elements.get("login").fire("click");
await new Promise((r) => setTimeout(r, 10));
const ws = sockets[0];
if (!ws) throw new Error("main.js did not open a socket");

const messages = [
  { t: "login", result: 0, worlds: [{ name: "Scania", unknownId: 0 }] },
  { t: "characters", result: 0, characters: [{ id: 21, name: "Hero", level: 12, job: 0, hp: 50, maxHp: 50, mapId: 1000000 }] },
  { t: "field", mapId: 1000000, self: { characterId: 21, name: "Hero", level: 12, job: 0, hp: 50, maxHp: 50, mp: 30, maxMp: 30, exp: 0, mesos: 200, mapId: 1000000, face: 20000 }, users: [], mobs: [], npcs: [] },
  { t: "user-enter", user: { characterId: 22, name: "Alt", face: 20000, avatarItems: [], x: 10, y: 20, action: 0, foothold: 0 } },
  { t: "user-move", characterId: 22, x: 30, y: 40, action: 0, foothold: 0 },
  { t: "user-move", characterId: 21, x: 30, y: 40, action: 0, foothold: 0 },
  { t: "user-emotion", characterId: 22, emotion: 3 },
  { t: "level-up", characterId: 22 },
  { t: "chat", name: "Alt", text: "hello" },
  { t: "mob-enter", mob: { mobId: 1, templateId: 1210100, x: 5, y: 6, facing: 0 } },
  { t: "mob-move", mobId: 1, x: 7, y: 8 },
  { t: "mob-leave", mobId: 1 },
  { t: "npc-enter", npc: { npcId: 2, templateId: 2003, x: 1, y: 2, facing: 0 } },
  { t: "npc-leave", npcId: 2 },
  { t: "self", self: { characterId: 21, name: "Hero", level: 13, job: 0, hp: 40, maxHp: 60, mp: 20, maxMp: 40, exp: 5, mesos: 150, mapId: 1000000, face: 20000 } },
  { t: "unknown", opcode: 0x42, bytes: 3 },
  { t: "user-leave", characterId: 22 },
  { t: "disconnect", reason: "closed" },
  { t: "created", ok: true, name: "Rookie", id: 9 },
  { t: "created", ok: false, name: "Rookie", reason: "name check 1" },
  { t: "error", message: "boom" },
];
for (const message of messages) ws.push(message);
await new Promise((r) => setTimeout(r, 50));
for (const fn of windowListeners.keydown ?? []) fn({ key: "ArrowRight", preventDefault() {} });
intervals.at(-1)();
await new Promise((r) => setTimeout(r, 10));
// The emote bar: seven buttons, one per F-key face (1..7).
const buttons = elements.get("emotes").children;
console.log("emote buttons:", buttons.length, buttons.map((b) => b.textContent).join(","));
buttons[2].fire("click");  // 1,2,3 -> "smile"

elements.get("new-name").value = "Rookie";
elements.get("create").fire("click");
elements.get("say").value = "hi there";
elements.get("say").fire("keydown", { key: "Enter", shiftKey: false });

// /w keeps the typed line (the wire's answer carries no text) and prints "name<< text" on delivery.
elements.get("say").value = "/w Alt hi there";
elements.get("say").fire("keydown", { key: "Enter", shiftKey: false });
ws.push({ t: "whisper-answer", name: "Alt", delivered: true });
ws.push({ t: "whisper-answer", name: "Nobody", delivered: false });
elements.get("say").value = "/f Hero";
elements.get("say").fire("keydown", { key: "Enter", shiftKey: false });
ws.push({ t: "find-answer", name: "Hero", mapId: 1000000 });
ws.push({ t: "find-answer", name: "Nobody", mapId: -1 });
elements.get("say").value = "/x nope";
elements.get("say").fire("keydown", { key: "Enter", shiftKey: false });
elements.get("say").value = "/w Alt";
elements.get("say").fire("keydown", { key: "Enter", shiftKey: false });
await new Promise((r) => setTimeout(r, 10));
await new Promise((r) => setTimeout(r, 10));
console.log("after input:", JSON.stringify(sent));
const chatHtml = elements.get("chat-lines").children.map((li) => li.children.map((c) => c.textContent).join(""));
console.log("chat lines:", JSON.stringify(chatHtml));
// `field` already fetched map 1000000, so a find answer for it carries the name...
elements.get("say").value = "/f Hero";
elements.get("say").fire("keydown", { key: "Enter", shiftKey: false });
ws.push({ t: "find-answer", name: "Hero", mapId: 1000000 });
// ...while one for a map this page has never fetched does not (and is a bare id).
ws.push({ t: "find-answer", name: "Hero", mapId: 2000000 });
await new Promise((r) => setTimeout(r, 10));
const later = elements.get("chat-lines").children.map((li) => li.children.map((c) => c.textContent).join(""));
console.log("find lines:", JSON.stringify(later.slice(-2)));

// The portal hit test, with the camera where main.js puts it: self at the centre of 800x600, then
// clamped to the map's rectangle (the stub map is 1000x692, so x is clamped and y is too).
const cameraX = Math.max(0, Math.min(1000 - 800, 0 - 800 / 2));
const cameraY = Math.max(0, Math.min(692 - 600, 0 - 600 / 2));
const doorX = 200 - cameraX;
const doorY = 181 - cameraY;
canvasEl.fire("mousemove", { clientX: doorX, clientY: doorY });
console.log("cursor over door:", canvasEl.style.cursor, `(clicked ${doorX},${doorY})`);
canvasEl.fire("click", { clientX: doorX, clientY: doorY });
canvasEl.fire("mousemove", { clientX: 5, clientY: 5 });
console.log("cursor off door:", canvasEl.style.cursor);
const last = sent[sent.length - 1];
if (JSON.stringify(last) !== JSON.stringify({ t: "portal", name: "door" })) throw new Error(`no portal sent: ${JSON.stringify(last)}`);
canvasEl.fire("click", { clientX: doorX, clientY: doorY });  // inside the 600 ms gate: must not send twice
if (sent.filter((m) => m.t === "portal").length !== 1) throw new Error("the portal guard did not hold");
console.log("portal click ok:", JSON.stringify(last));
if (elements.get("status").textContent === "" && !elements.get("status").innerHTML) console.log("note: status empty");
console.log("status:", JSON.stringify(elements.get("status").textContent || elements.get("status").innerHTML));
console.log("chat input placeholder:", JSON.stringify(elements.get("say").placeholder));
console.log("where:", JSON.stringify(elements.get("where").textContent));
console.log("chat lines:", JSON.stringify(elements.get("chat-lines").innerHTML));
// ---------------------------------------------------------------- shop & NPC click
// An NPC standing where the camera says, so `npcAt` can find it: the page's hit box is 18x34 above
// the ground point, plus slack.
const npcScreenX = 300;
const npcScreenY = 420;
// Put the local character at a known place first (`self` follows its own `user-move`), so the
// camera is exactly (0 - 400, 0 - 300) clamped to the stub map and `screen = world - camera` can be
// inverted here.
ws.push({ t: "user-move", characterId: 21, x: 0, y: 0, action: 0, foothold: 0 });
const npcCameraX = Math.max(0, Math.min(1000 - 800, 0 - 400));
const npcCameraY = Math.max(0, Math.min(692 - 600, 0 - 300));
ws.push({ t: "npc-enter", npc: { npcId: 7, templateId: 2003, x: npcScreenX + npcCameraX, y: npcScreenY + npcCameraY, facing: 0 } });
canvasEl.fire("mousemove", { clientX: npcScreenX, clientY: npcScreenY - 20 });
if (canvasEl.style.cursor !== "pointer") throw new Error("the cursor should point at an NPC");
canvasEl.fire("click", { clientX: npcScreenX, clientY: npcScreenY - 20 });
const clickSent = sent[sent.length - 1];
console.log("npc click:", JSON.stringify(clickSent));
if (clickSent.t !== "click" || clickSent.objectId !== 7) throw new Error(`bad npc click: ${JSON.stringify(clickSent)}`);

// The sell pane reads the open inventory, so the player has a potion there before the shop opens.
ws.push({
  t: "inventory",
  inventory: { worn: [], wornCash: [], tabs: [
    { tab: 1, capacity: 24, items: [] },
    { tab: 2, capacity: 24, items: [{ slot: 1, itemId: 2000000, quantity: 3 }] },
    { tab: 3, capacity: 24, items: [] },
    { tab: 4, capacity: 24, items: [] },
  ] },
});
await new Promise((r) => setTimeout(r, 10));
ws.push({
  t: "shop-open",
  shop: { shopId: 2003, items: [{ itemId: 2000000, price: 25, maxCount: 200 }, { itemId: 2030000, price: 75, maxCount: 5 }] },
});
await new Promise((r) => setTimeout(r, 10));
// The sheet is drawn on the canvas at its centred spot (196, 154): row 1 of the left list is
// (6..200, 68..100), the 사기 button (78,31)-(124,50), the tab strip (206..404, 65..89) and the
// CLOSE stamp (188,9)-(220,24). The test clicks those exact window-local points.
const shopPoint = (x, y) => ({ clientX: 196 + x, clientY: 154 + y, preventDefault() {} });
canvasEl.fire("click", shopPoint(40, 80));                   // pick the first row
canvasEl.fire("click", shopPoint(100, 40));                  // 사기
let lastShop = sent[sent.length - 1];
console.log("buy 1:", JSON.stringify(lastShop));
if (lastShop.t !== "shop" || lastShop.action !== "buy" || lastShop.row !== 0 || lastShop.count !== 1) {
  throw new Error(`bad buy: ${JSON.stringify(lastShop)}`);
}
canvasEl.fire("dblclick", shopPoint(40, 115));               // second row, double click buys it
lastShop = sent[sent.length - 1];
console.log("double click buy:", JSON.stringify(lastShop));
if (lastShop.t !== "shop" || lastShop.action !== "buy" || lastShop.row !== 1) {
  throw new Error(`bad double click buy: ${JSON.stringify(lastShop)}`);
}
// The right pane starts on 장비; switch it to 소비 (second tab) to reach the potion in `inventory`.
canvasEl.fire("click", shopPoint(279, 77));
canvasEl.fire("click", shopPoint(280, 100));                 // first row of the sell pane
canvasEl.fire("click", shopPoint(306, 40));                  // 팔기
lastShop = sent[sent.length - 1];
console.log("sell:", JSON.stringify(lastShop));
if (lastShop.t !== "shop" || lastShop.action !== "sell" || lastShop.itemId !== 2000000) {
  throw new Error(`bad sell: ${JSON.stringify(lastShop)}`);
}
ws.push({ t: "shop-result", code: 2, message: "shop result 2 (notEnoughMesos)" });
await new Promise((r) => setTimeout(r, 10));
canvasEl.fire("click", shopPoint(204, 16));                  // CLOSE stamp
lastShop = sent[sent.length - 1];
console.log("shop close:", JSON.stringify(lastShop));
if (lastShop.t !== "shop" || lastShop.action !== "close") throw new Error("CLOSE must send shop close");

ws.push({ t: "npc-say", npcId: 7, message: "안녕하세요" });
await new Promise((r) => setTimeout(r, 10));
console.log("dialogue:", JSON.stringify(elements.get("dialogue-text").textContent), "hidden:", elements.get("dialogue").classList.contains("hidden"));
elements.get("dialogue-ok").fire("click");
console.log("talk ok:", JSON.stringify(sent[sent.length - 1]));
if (sent[sent.length - 1].t !== "talk" || sent[sent.length - 1].answer !== 1) throw new Error("確定 must send answer 1");
if (!elements.get("dialogue").classList.contains("hidden")) throw new Error("the dialogue should close on 確定");

// ---------------------------------------------------------------- inventory window
// `I` opens the sheet (there is no packet); it is drawn on the canvas, so the test drives it through
// the same pointer events a player would. The shim never finishes loading art, so only the hit
// testing and the `use` packet are observable here.
elements.get("log").classList.add("hidden");
windowListeners.keydown[0]({ key: "i", preventDefault() {} });
ws.push({
  t: "inventory",
  inventory: {
    worn: [],
    wornCash: [],
    tabs: [
      { tab: 1, capacity: 24, items: [] },
      { tab: 2, capacity: 24, items: [{ slot: 1, itemId: 2000000, quantity: 3 }, { slot: 4, itemId: 2030004, quantity: 1 }] },
      { tab: 3, capacity: 24, items: [] },
      { tab: 4, capacity: 24, items: [] },
    ],
  },
});
await new Promise((r) => setTimeout(r, 10));
const surface = (x, y) => ({ clientX: x, clientY: y, preventDefault() {} });
// The window opens at (114, 9); slot 1's face is at +6/+80, so its centre is (136, 105).
canvasEl.fire("click", surface(136, 105));
canvasEl.fire("dblclick", surface(136, 105));
const use = sent[sent.length - 1];
console.log("use sent:", JSON.stringify(use));
if (use.t !== "use" || use.slot !== 1 || use.itemId !== 2000000) throw new Error(`bad use: ${JSON.stringify(use)}`);
// Slot 4 holds the map-item sender (2030004), also usable from the USE tab.
canvasEl.fire("dblclick", surface(114 + 6 + 3 * 35 + 16, 105));
console.log("map item sent:", JSON.stringify(sent[sent.length - 1]));
// Tab 2 (소비) is the second box: x 36..70, y 52..76.
canvasEl.fire("click", surface(114 + 53, 9 + 64));
// The CLOSE pentagon at the top right closes it again.
canvasEl.fire("click", surface(114 + 130, 9 + 14));
console.log("closed:", (elements.get("inventory")) === undefined ? "no DOM panel" : "unexpected");
// The window was closed by the CLOSE click above; open it again so the frames draw it.
windowListeners.keydown[0]({ key: "i", preventDefault() {} });
for (let frame = 0; frame < 3; frame++) {
  const callback = frameCallback;
  frameCallback = undefined;
  callback?.(performance.now());
  // Let the art's `onload` land, so the next frame can draw the sheet and its icons.
  await new Promise((resolve) => setTimeout(resolve, 5));
}
console.log("rendered", 3, "frames; drawImage calls:", drawImageCalls);
if (drawImageCalls < 9) throw new Error(`the renderer drew too little: ${drawImageCalls}`);
console.log("handled", messages.length, "messages; sent", sent.length, "->", JSON.stringify(sent));
console.log("SMOKE OK");

// ---------------------------------------------------------------- shop regression cases
const assert = (await import("node:assert/strict")).default;
const stock = Array.from({ length: 12 }, (_, index) => ({ itemId: 2000000 + index, price: 25, maxCount: 200 }));
const items = Array.from({ length: 8 }, (_, index) => ({ slot: index + 1, itemId: 2000000 + index, quantity: 3 }));
const inventoryMessage = (rows) => ({ t: "inventory", inventory: { worn: [], wornCash: [], tabs: [
  { tab: 1, capacity: 24, items: [] }, { tab: 2, capacity: 24, items: rows },
  { tab: 3, capacity: 24, items: [] }, { tab: 4, capacity: 24, items: [] },
] } });
ws.push(inventoryMessage(items));
ws.push({ t: "shop-open", shop: { shopId: 2003, items: stock } });
canvasEl.fire("click", shopPoint(279, 77));
assert.equal(clientProbe.shopRowsOf("sell").length, 8);
// Clicking the very first pixel of a scrollbar must not select a row or start a window drag.
assert.equal(clientProbe.shopWindowAt(196 + 189, 154 + 80).kind, "scrollbar");
canvasEl.fire("click", shopPoint(195, 269)); // next arrow
assert.equal(clientProbe.scroll.buy, 1);
canvasEl.fire("click", shopPoint(195, 74)); // prev arrow
assert.equal(clientProbe.scroll.buy, 0);
canvasEl.fire("click", shopPoint(195, 200)); // page down
assert.equal(clientProbe.scroll.buy, 6);
canvasEl.fire("wheel", { ...shopPoint(195, 180), deltaY: -1 });
assert.equal(clientProbe.scroll.buy, 5); // wheel over the scrollbar itself
canvasEl.fire("wheel", { ...shopPoint(195, 180), deltaY: 0 });
assert.equal(clientProbe.scroll.buy, 5);
canvasEl.fire("click", shopPoint(195, 74));
const thumbY = 68 + 12 + clientProbe.shopScrollbarGeometry("buy").offset + 6;
canvasEl.fire("mousedown", shopPoint(195, thumbY));
canvasEl.fire("mousemove", shopPoint(195, 268));
canvasEl.fire("mouseup", shopPoint(195, 268));
canvasEl.fire("click", shopPoint(195, 268)); // native click following a drag is suppressed
assert.equal(clientProbe.scroll.buy, 6);
canvasEl.fire("click", shopPoint(40, 80));
canvasEl.fire("click", shopPoint(100, 40));
assert.equal(sent.at(-1).row, 6); // visible row zero refers to stock row six
// Inventory shrinking under the scroll thumb clamps the offset; removed selections cannot sell.
canvasEl.fire("wheel", { ...shopPoint(280, 230), deltaY: 1 });
assert.equal(clientProbe.scroll.sell, 1);
canvasEl.fire("click", shopPoint(280, 100));
assert.equal(clientProbe.picked.itemId, items[1].itemId);
ws.push(inventoryMessage([items[0]]));
assert.equal(clientProbe.scroll.sell, 0);
assert.equal(clientProbe.picked, undefined);
const before = sent.length;
canvasEl.fire("click", shopPoint(306, 40));
assert.equal(sent.length, before);
// A drag released outside the canvas must finish, persist and never leave the button depressed.
canvasEl.fire("mousedown", shopPoint(20, 20));
canvasEl.fire("mousemove", shopPoint(30, 30));
for (const handler of windowListeners.mouseup) handler({});
assert.equal(clientProbe.dragging, false);
assert.deepEqual(JSON.parse(storage.get("kms111.shopAt")), { x: 206, y: 164 });
// Both literal WZ escapes and actual line breaks are kept as separate tooltip lines.
clientProbe.setFacts(2000000, { name: "Potion", desc: "First\\nSecond\nThird\r\nFourth" });
assert.deepEqual(clientProbe.itemTooltipLines({ itemId: 2000000 }), ["Potion", "First", "Second", "Third", "Fourth"]);
console.log("SHOP REGRESSIONS OK");
