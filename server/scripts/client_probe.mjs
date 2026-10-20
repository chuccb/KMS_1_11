// Offline VM/DOM shim that evaluates the REAL client/main.js (ADR-108 revived it onto the typed
// module generation with a generic import shim). Feature-level native regressions additionally
// live in server/test/native-chat-gameoptions.test.ts and the typed browser probes.
import assert from "node:assert/strict";
const { readFileSync } = await import("node:fs");
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
  fire(type, event = {}) {
    event.preventDefault ??= () => {};
    let stopped = false;
    event.stopPropagation ??= () => { stopped = true; };
    // Delegated handlers (login-screen world/character rows, player-menu) read event.target and
    // closest("button"), so events carry the browser's target and bubble up the shim parent chain
    // exactly like the DOM; stopPropagation really stops the walk.
    event.target ??= this;
    // A real MouseEvent defaults to the primary button; typed handlers (e.g. login-screen.ts)
    // gate on event.button === 0, so the shim must deliver the browser's default event shape.
    if (/^(?:click|auxclick|mousedown|mouseup|mouseenter|mouseleave|mousemove|pointerdown|pointerup|pointermove|pointercancel)$/.test(type))
      event.button ??= 0;
    let node = this;
    while (node && !stopped) {
      for (const fn of node.listeners?.[type] ?? []) {
        fn(event);
        if (stopped) break;
      }
      node = node.parent;
    }
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) {
    // Detached children lose the parent link; kept ones gain it - delegated handlers and the
    // bubbling fire() walk this chain (login-screen.ts rebuilds rows with replaceChildren).
    for (const child of this.children) if (child.parent === this) child.parent = undefined;
    for (const node of nodes) node.parent = this;
    this.children = [...nodes];
  }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  // ChildNode.before: chatlog.ts re-renders a message group in place with old[0].before(...rows).
  before(...nodes) {
    const parent = this.parent;
    if (!parent) return;
    let index = parent.children.indexOf(this);
    if (index < 0) return;
    for (const node of nodes) { node.parent = parent; parent.children.splice(index++, 0, node); }
  }
  remove() {
    const parent = this.parent;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parent = undefined;
  }
  focus() { document.activeElement = this; }
  blur() { if (document.activeElement === this) document.activeElement = null; }
  select() {}
  setCustomValidity(value) { this.validationMessage = value; }
  setAttribute(name, value) { (this.attributes ??= {})[name] = value; }
  getAttribute(name) { return this.attributes?.[name] ?? null; }
  hasAttribute(name) { return this.attributes ? name in this.attributes : false; }
  removeAttribute(name) { if (this.attributes) delete this.attributes[name]; }
  get parentElement() { return this.parent ?? null; }
  // Zeroed box metrics: chatlog.ts clamps with scrollHeight-clientHeight and display-controls.ts
  // falls back to window.innerWidth/Height when clientWidth is 0 - both real-browser behaviors.
  clientWidth = 0;
  clientHeight = 0;
  // The tag/id/attribute/class selectors the client's delegated handlers actually use
  // (closest("button") in login-screen/player-menu/skills, [data-x] in chatlog/lens-controls).
  matches(selector) {
    return selector.split(",").some((part) => {
      const sel = part.trim();
      if (sel.startsWith("#")) return this.id === sel.slice(1);
      if (sel.startsWith("[")) return this.hasAttribute(sel.slice(1, -1).split("=")[0]);
      if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
      return this.tag === sel;
    });
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parent;
    }
    return null;
  }
  contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html ?? ""; }
  get firstElementChild() { return this.children[0] ?? null; }
  getContext() { return ctxStub; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  get localName() { return this.tag; }
  // scene-surface.ts builds its render buffer through canvas.ownerDocument.createElement.
  get ownerDocument() { return document; }
  // client/dom.ts requireQuery validates localName, so selector hits must carry the REAL tag the
  // selector has in index.html; per-element caching keeps repeated queries referentially stable.
  querySelector(selector) {
    const cached = (this._queries ??= new Map());
    if (!cached.has(selector)) cached.set(selector, new El(shimTagFor(selector)));
    return cached.get(selector);
  }
}
// The real index.html schema drives shim tags: requireElement/requireQuery (client/dom.ts) check
// localName against the tag each id/data-selector actually has in the shipped document. Parsing
// the document keeps this shim from rotting into another hardcoded allowlist.
const indexHtml = readFileSync(new URL("../../client/index.html", import.meta.url), "utf8");
const shimTagById = new Map();
const shimTagByData = new Map();
for (const chunk of indexHtml.split("<").slice(1)) {
  const tagSource = chunk.split(">")[0];
  const tag = /^[a-z0-9]+/.exec(tagSource)?.[0];
  if (!tag) continue;
  const id = /\bid="([^"]+)"/.exec(tagSource)?.[1];
  if (id) shimTagById.set(id, tag);
  for (const data of tagSource.matchAll(/\b(data-[a-z0-9-]+)/g)) shimTagByData.set(data[1], tag);
}
function shimTagFor(selector) {
  if (selector.startsWith("#")) return shimTagById.get(selector.slice(1)) ?? "div";
  const data = /^\[(data-[a-z0-9-]+)(?:=[^\]]*)?\]$/.exec(selector)?.[1];
  if (data) return shimTagByData.get(data) ?? "div";
  return "div";
}
const canvasEl = new El("canvas");
canvasEl.id = "view";
let drawImageCalls = 0;
const drawn = [];
const ctxStub = new Proxy({}, {
  get(target, prop) {
    if (prop === "canvas") return canvasEl;
    if (prop === "measureText") return (text) => ({ width: String(text).length * 6 });
    if (prop === "drawImage") return (image, ...coordinates) => { drawImageCalls += 1; drawn.push([image.src, ...coordinates]); };
    if (!(prop in target)) target[prop] = () => {};
    return target[prop];
  },
  set(target, prop, value) { target[prop] = value; return true; },
});
const elements = new Map();
globalThis.HTMLInputElement = El;
// login-screen/player-menu guard delegated clicks with instanceof Element/HTMLButtonElement.
globalThis.Element = El;
globalThis.HTMLElement = El;
globalThis.HTMLButtonElement = El;
const documentListeners = {};
globalThis.document = {
  documentElement: new El("html"),
  getElementById(id) {
    if (!elements.has(id)) {
      const element = id === "view" ? canvasEl : new El(shimTagById.get(id) ?? "div");
      element.id ??= id;
      elements.set(id, element);
    }
    return elements.get(id);
  },
  activeElement: null,
  // client/pointer.ts releases pressed pointers on visibilitychange through these.
  // movementBlocked() (main.js) gates input on the page being visible AND focused; the probe
  // drives a foreground page, so hasFocus mirrors a focused document.
  hidden: false,
  hasFocus: () => true,
  addEventListener(type, fn) { (documentListeners[type] ??= []).push(fn); },
  removeEventListener(type, fn) {
    const list = documentListeners[type];
    const index = list?.indexOf(fn) ?? -1;
    if (index >= 0) list.splice(index, 1);
  },
  dispatchEvent(event) {
    for (const fn of documentListeners[event.type] ?? []) fn(event);
    return true;
  },
  createElement(tag) { return new El(tag); },
  createTextNode(text) { return { textContent: text }; },
};
const windowListeners = {};
globalThis.window = {
  devicePixelRatio: 1, innerWidth: 800, innerHeight: 600,
  addEventListener(type, fn) { (windowListeners[type] ??= []).push(fn); },
  removeEventListener(type, fn) {
    const list = windowListeners[type];
    const index = list?.indexOf(fn) ?? -1;
    if (index >= 0) list.splice(index, 1);
  },
  // main.js's last statement dispatches CLIENT_READY_EVENT; the startup guard (startup-guard.ts)
  // flips documentElement.dataset.clientState to "ready" through this synchronous delivery.
  dispatchEvent(event) {
    for (const fn of windowListeners[event.type] ?? []) fn(event);
    return true;
  },
};
globalThis.Event = class {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};
// Real browser delivery for canvas interaction (ADR-108): a mouseup/mousemove over the canvas
// bubbles to the WINDOW listeners main.js uses for sprite-button activation and window drags, and
// native CCtrlButton controls (shop buy/sell/close, inventory close, status, trade) activate only
// when the full mousedown -> mouseup -> click trio lands on the same control. Rows, tabs and
// scrollbars are not controls and stay bare clicks.
const windowMouseUp = (point = {}) => {
  for (const fn of windowListeners.mouseup ?? [])
    fn({ button: 0, target: canvasEl, preventDefault() {}, stopPropagation() {}, ...point });
};
const canvasMouseMove = (point) => {
  canvasEl.fire("mousemove", { ...point });
  for (const fn of windowListeners.mousemove ?? []) fn({ ...point, target: canvasEl });
};
const clickControl = (point) => {
  canvasEl.fire("mousedown", { ...point });
  windowMouseUp(point);
  canvasEl.fire("click", { ...point });
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
  // The real /api/map JSON lists its NPCs (webclient.ts mapPayload), and loadMap preloads their
  // metadata from exactly this list; the stub carries the one template the NPC battery clicks.
  mobs: [], npcs: [{ templateId: 2003, x: 300, y: 420, foothold: 32 }],
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
  if (path === "/api/maps") return {ok:true,status:200,json:async()=>[STUB_MAP]};
  if (path.startsWith("/api/skills/")) return {ok:true,status:200,json:async()=>({job:0,books:[]})};
  let body = STUB_MAP;
  if (path === '/api/creation') {
    const make = (sets) => sets.map((set) => set.map((id) => ({ id, name: `option ${id}` })));
    // isCreationCatalog (ui-resource-validation.ts) also requires the WZ ForbiddenName list.
    body = { forbidden: [], male: make([[20000,20001,20002],[30030,30020,30000],[1040002,1040006,1040010],[1060002,1060006],[1072001,1072005],[1302000,1322005,1312004]]), female: make([[21000,21001,21002],[31000,31040,31054],[1041002,1041006,1041010,1041011],[1061002,1061008],[1072001,1072005],[1302000,1322005,1312004]]) };
  } else if (path.endsWith("/art")) body = STUB_ART;
  // isNpcMetadata (entity-resource-validation.ts) requires the full record; the click rectangle is
  // the server's own native dc* fallback (npcClickBounds, sprites.ts), not an invented hit box.
  else if (path.startsWith("/api/npc/")) body = { templateId: 2003, name: "NPC", behavior: { movable: false, speak: [], extraActions: [] }, clickBounds: { left: -22, top: -65, right: 22, bottom: 0 }, actions: { stand: [{ path: "Npc/0002003.img/stand/0", delay: 1000, ox: 20, oy: 40 }] } };
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

const { runInThisContext } = await import("node:vm");
Object.assign(globalThis, await import("../../client/motion.ts"));
Object.assign(globalThis, await import("../../client/portals.ts"));
Object.assign(globalThis, await import("../../client/display.ts"));
Object.assign(globalThis, await import("../../client/minimap.ts"));
Object.assign(globalThis, await import("../../client/equipment.ts"));
Object.assign(globalThis, await import("../../client/itemdialogs.ts"));
Object.assign(globalThis, await import("../../client/audio.ts"));
Object.assign(globalThis, await import("../../client/selection.ts"));
Object.assign(globalThis, await import("../../client/creation.ts"));
Object.assign(globalThis, await import("../../client/scene.ts"));
Object.assign(globalThis, await import("../../client/statwindow.ts"));
Object.assign(globalThis, await import("../../client/skills.ts"));
Object.assign(globalThis, await import("../../client/jobs.ts"));
Object.assign(globalThis, await import("../../client/recovery.ts"));
Object.assign(globalThis, await import("../../client/testtools.ts"));
Object.assign(globalThis, await import("../../client/temporarystats.ts"));
Object.assign(globalThis, await import("../../client/basiccombat.ts"));
Object.assign(globalThis, await import("../../client/tooltip.ts"));
Object.assign(globalThis, await import("../../client/tooltip-preview.ts"));
Object.assign(globalThis, await import("../../client/faces.ts"));
Object.assign(globalThis, await import("../../client/avatar-motion.ts"));
// ADR-069 added this import shim; current Bun execution/compatibility status: docs/BUN_MIGRATION.md.
Object.assign(globalThis, await import("../../client/posture.ts"));
Object.assign(globalThis, await import("../../client/attack-timing.ts"));
Object.assign(globalThis, await import("../../client/combat-assets.ts"));
// ADR-108 generic import shim: main.js's own top-level `import {a, b} from "./mod.ts"` lines are
// stripped and each requested binding is exposed as a global from the REAL module - exactly the
// free-identifier contract classic-script evaluation needs, for every module main.js actually
// imports. The former hardcoded strip list only knew the .mjs generation and rotted with every
// module split, which is why this probe was stuck while main.js moved on to ~90 typed modules.
const mainUrl = new URL("../../client/main.js", import.meta.url);
let mainSource = readFileSync(mainUrl, "utf8");
const mainImports = [];
mainSource = mainSource.replace(
  /^import\s*\{([^}]*)\}\s*from\s*["'](\.\/[^"']+)["'];?[ \t]*\r?\n/gm,
  (statement, names, specifier) => {
    mainImports.push([names, specifier]);
    // Blank the statement but keep its newlines so vm stack traces match client/main.js lines.
    return statement.replace(/[^\n]/g, "");
  },
);
if (/^import[\s{*]/m.test(mainSource))
  throw new Error("client_probe: unrecognized import form in client/main.js");
for (const [names, specifier] of mainImports) {
  const module = await import(new URL(specifier, mainUrl).href);
  for (const entry of names.split(",")) {
    const name = entry.trim();
    if (!name) continue;
    const [exported, local = exported] = name.split(/\s+as\s+/).map((part) => part.trim());
    if (!(exported in module))
      throw new Error(`client_probe: ${specifier} does not export ${exported}`);
    globalThis[local] = module[exported];
  }
}
// index.html loads two ordered module entries: ./startup.ts (installs the startup guard, which
// gates every login attempt through documentElement.dataset.clientState) and then ./main.js.
// The probe reproduces that order; main.js's final dispatchEvent flips the guard to "ready".
await import("../../client/startup.ts");
runInThisContext(mainSource + `
;globalThis.clientProbe = {
  testToolsPanel, skillPanel, itemDialog, inventoryScrollbarGeometry, inventoryWindowAt, setInventoryScroll,
  wearItem, sourceItem, get inventory(){return inventory;}, get remoteUsers(){return users;},
  runCommand, shopRowsOf, shopScrollbarGeometry, shopWindowAt, drawItemTooltip,
  get scroll() { return { ...shopScroll }; },
  get shopPosition() { return { ...shopAt }; },
  get picked() { return shopSellPick; },
  get dragging() { return shopDrag !== undefined || shopScrollDrag !== undefined; },
  get pressed() { return shopPressed; },
  // The typed login UI (login-screen.ts) owns title/selection state since its module round;
  // main.js holds it as loginScreens, whose getters are the probe's observation points.
  get stage() { return loginScreens.stage; },
  get dialog() { return loginScreens.titleDialogOpen; },
  get inventoryOpen() { return inventoryOpen; },
  setFacts(id, facts) { itemInfo.set(id, facts); },
};`, { filename: "client/main.js" });
await new Promise((r) => setTimeout(r, 10));
// Title and modal are drawn at original coordinates, and use the WZ button state sprites.
const render = async () => {
  frameCallback?.(performance.now());
  await new Promise((resolve) => setTimeout(resolve, 5));
  frameCallback?.(performance.now());
};
assert.equal(clientProbe.stage, "title");
assert.equal(clientProbe.dialog, false);
await render();
const stamp = (path, x, y) => drawn.some(([src, atX, atY]) => decodeURIComponent(src ?? "").endsWith(path) && atX === x && atY === y);
assert.ok(stamp("UI/Login.img/Title/backgrnd", 0, 0));
assert.ok(stamp("UI/Login.img/Title/menu", 302, 358));
assert.ok(stamp("UI/Login.img/Title/BtContinue/normal/0", 356, 423));
elements.get("title-continue").fire("mouseenter");
await render();
assert.ok(stamp("UI/Login.img/Title/BtContinue/mouseOver/0", 356, 423));
elements.get("title-continue").fire("mousedown");
await render();
assert.ok(stamp("UI/Login.img/Title/BtContinue/pressed/0", 356, 423));
elements.get("title-continue").fire("click");
assert.equal(clientProbe.dialog, true);
assert.equal(elements.get("title-menu").classList.contains("hidden"), true);
await render();
assert.ok(stamp("UI/Login.img/Title/loginDlg", 247, 215));
assert.ok(stamp("UI/Basic.img/BtOK/normal/0", 373, 342));
elements.get("pass").value = "must-clear";
for (const handler of windowListeners.keydown) handler({ key: "Escape" });
assert.equal(clientProbe.dialog, false);
assert.equal(elements.get("pass").value, "");
elements.get("title-continue").fire("click");
// A focused login field owns Enter and I; they must not activate chat or the inventory.
document.activeElement = elements.get("user");
for (const handler of windowListeners.keydown) handler({ key: "i" });
assert.equal(clientProbe.inventoryOpen, false);
document.activeElement = null;
elements.get("remember-user").checked = true;
elements.get("user").value = "admin";
elements.get("pass").value = "admin";
elements.get("login").fire("click");
elements.get("login").fire("click"); // duplicate press is ignored while pending
assert.equal(sockets.length, 1);
assert.equal(elements.get("user").disabled, true);
await render();
assert.ok(stamp("UI/Basic.img/BtOK/disabled/0", 373, 342));
await new Promise((r) => setTimeout(r, 10));
const ws = sockets[0];
if (!ws) throw new Error("main.js did not open a socket");

const messages = [
  { t: "login", result: 0, worlds: [{ name: "Scania", unknownId: 0 }] },
  { t: "characters", result: 0, characters: [{ id: 21, name: "Hero", level: 12, job: 0, face: 20000, hair: 30000, hp: 50, maxHp: 50, mp: 30, maxMp: 30, exp: 0, mesos: 200, mapId: 1000000, str: 4, dex: 4, int: 4, luk: 4, items: [] }] },
  { t: "field", mapId: 1000000, self: { characterId: 21, name: "Hero", level: 12, job: 0, hp: 50, maxHp: 50, mp: 30, maxMp: 30, exp: 0, mesos: 200, mapId: 1000000, face: 20000 }, users: [], mobs: [], npcs: [] },
  { t: "user-enter", user: { characterId: 22, name: "Alt", face: 20000, avatarItems: [], x: 10, y: 20, action: 0, foothold: 0 } },
  { t: "user-move", characterId: 22, x: 30, y: 40, action: 0, foothold: 0 },
  { t: "user-move", characterId: 21, x: 30, y: 40, action: 0, foothold: 0 },
  { t: "user-emotion", characterId: 22, emotion: 3 },
  { t: "level-up", characterId: 22 },
  { t: "chat", channel: "field", characterId: 22, name: "Alt", text: "hello" },
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
assert.equal(elements.get("pass").value, "");
assert.equal(storage.get("kms111.loginUser"), "admin");
assert.equal(clientProbe.stage, "game");
assert.equal(elements.get("title-ui").classList.contains("hidden"), true);
assert.ok(![...storage.values()].some((value) => value.includes("password")));
await new Promise((r) => setTimeout(r, 50));
for (const fn of windowListeners.keydown ?? []) fn({ key: "ArrowRight", preventDefault() {} });
intervals.at(-1)();
await new Promise((r) => setTimeout(r, 10));
// The emote bar: seven buttons, one per F-key face (1..7).
const buttons = elements.get("emotes").children;
console.log("emote buttons:", buttons.length, buttons.map((b) => b.textContent).join(","));
buttons[2].fire("click");  // 1,2,3 -> "smile"

elements.get("new-name").value = "Rookie";
// Creation is now a modal checked-name workflow, tested separately below.
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
const chatHtml = elements.get("chat-lines").children.map((li) => li.textContent);
console.log("chat lines:", JSON.stringify(chatHtml));
// `field` already fetched map 1000000, so a find answer for it carries the name...
elements.get("say").value = "/f Hero";
elements.get("say").fire("keydown", { key: "Enter", shiftKey: false });
ws.push({ t: "find-answer", name: "Hero", mapId: 1000000 });
// ADR-059: an uncached map starts with an explicit id, then asynchronously loads street:map.
ws.push({ t: "find-answer", name: "Hero", mapId: 2000000 });
await new Promise((r) => setTimeout(r, 10));
const later = elements.get("chat-lines").children.map((li) => li.textContent);
console.log("find lines:", JSON.stringify(later.slice(-2)));

// The transport battery above ends with disconnect/created/error on purpose, and every one of
// those bumps mapGeneration (main.js's stale-map guard), which voids the first field's async
// loadMap. A real reconnect re-enters the field, so the gameplay batteries do the same and wait
// for the map JSON before clicking portals.
ws.push({ t: "field", mapId: 1000000, self: { characterId: 21, name: "Hero", level: 12, job: 0, hp: 50, maxHp: 50, mp: 30, maxMp: 30, exp: 0, mesos: 200, mapId: 1000000, face: 20000 }, users: [], mobs: [], npcs: [] });
await new Promise((r) => setTimeout(r, 20));

// The portal hit test, with the camera where main.js puts it: self at the centre of 800x600, then
// clamped to the map's rectangle (the stub map is 1000x692, so x is clamped and y is too).
const cameraX = Math.max(0, Math.min(1000 - 800, 0 - 800 / 2));
const cameraY = Math.max(0, Math.min(692 - 600, 0 - 600 / 2));
const doorX = 200 - cameraX;
const doorY = 181 - cameraY;
canvasMouseMove({ clientX: doorX, clientY: doorY });
canvasEl.fire("click", { clientX: doorX, clientY: doorY });
canvasMouseMove({ clientX: 5, clientY: 5 });
const last = sent[sent.length - 1];
if (JSON.stringify(last) !== JSON.stringify({ t: "portal", name: "door" })) throw new Error(`no portal sent: ${JSON.stringify(last)}`);
canvasEl.fire("click", { clientX: doorX, clientY: doorY });  // inside the 600 ms gate: must not send twice
if (sent.filter((m) => m.t === "portal").length !== 1) throw new Error("the portal guard did not hold");
console.log("portal click ok:", JSON.stringify(last));
// A real server answers the portal request with the destination field, and portalPending (which
// gates item use, attacks and further portals) only clears on that map change. Answer it the way
// the wire does before the gameplay batteries continue.
ws.push({ t: "field", mapId: 1010000, self: { characterId: 21, name: "Hero", level: 12, job: 0, hp: 50, maxHp: 50, mp: 30, maxMp: 30, exp: 0, mesos: 200, mapId: 1010000, face: 20000 }, users: [], mobs: [], npcs: [] });
await new Promise((r) => setTimeout(r, 20));
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
// The hit rectangle comes from the NPC's OWN metadata (info.dc*): wait for the async load, then
// hit-test through the click packet. 70f9405 restored the native arrow cursor, so hovering an NPC
// no longer repaints a CSS pointer; the sent packet is the observable contract.
await new Promise((r) => setTimeout(r, 20));
canvasMouseMove({ clientX: npcScreenX, clientY: npcScreenY - 20 });
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
clickControl(shopPoint(100, 40));                            // 사기 opens quantity
assert.equal(clientProbe.itemDialog.open, true);
elements.get("item-dialog-ok").fire("click");
let lastShop = sent[sent.length - 1];
console.log("buy 1:", JSON.stringify(lastShop));
if (lastShop.t !== "shop" || lastShop.action !== "buy" || lastShop.row !== 0 || lastShop.count !== 1) {
  throw new Error(`bad buy: ${JSON.stringify(lastShop)}`);
}
ws.push({ t: "shop-result", code: 0, message: "silent" });
canvasEl.fire("dblclick", shopPoint(40, 115));               // second row opens quantity
elements.get("item-dialog-ok").fire("click");
lastShop = sent[sent.length - 1];
console.log("double click buy:", JSON.stringify(lastShop));
if (lastShop.t !== "shop" || lastShop.action !== "buy" || lastShop.row !== 1) {
  throw new Error(`bad double click buy: ${JSON.stringify(lastShop)}`);
}
ws.push({ t: "shop-result", code: 0, message: "silent" });
// The right pane starts on 장비; switch it to 소비 (second tab) to reach the potion in `inventory`.
canvasEl.fire("click", shopPoint(279, 77));
canvasEl.fire("click", shopPoint(280, 100));                 // first row of the sell pane
clickControl(shopPoint(306, 40));                            // 팔기 opens total/1/total
elements.get("item-dialog-ok").fire("click");
lastShop = sent[sent.length - 1];
console.log("sell:", JSON.stringify(lastShop));
if (lastShop.t !== "shop" || lastShop.action !== "sell" || lastShop.itemId !== 2000000) {
  throw new Error(`bad sell: ${JSON.stringify(lastShop)}`);
}
ws.push({ t: "shop-result", code: 2, message: "shop result 2 (notEnoughMesos)" });
await new Promise((r) => setTimeout(r, 10));
clickControl(shopPoint(204, 16));                            // CLOSE stamp
lastShop = sent[sent.length - 1];
console.log("shop close:", JSON.stringify(lastShop));
if (lastShop.t !== "shop" || lastShop.action !== "close") throw new Error("CLOSE must send shop close");

ws.push({ t: "npc-say", npcId: 7, message: "안녕하세요" });
await new Promise((r) => setTimeout(r, 10));
console.log("dialogue:", JSON.stringify(elements.get("dialogue-text").textContent), "hidden:", elements.get("dialogue").classList.contains("hidden"));
// npcdialogue.ts builds the answer buttons into #dialogue-controls (no static ids) and clears
// them per dialogue; for a plain say the spec list is [close=255, primary OK=1] (the native
// 0xFF close vs the answer-1 OK, npcdialogue-layout.ts dialogueButtons). A programmatic click
// carries detail 0 - the browser's own element.click() semantics the released-gate accepts.
elements.get("dialogue-controls").children
  .find((b) => b.dataset.dialogueKey === "primary")
  .fire("click");
console.log("talk ok:", JSON.stringify(sent[sent.length - 1]));
if (sent[sent.length - 1].t !== "talk" || sent[sent.length - 1].answer !== 1) throw new Error("確定 must send answer 1");
if (!elements.get("dialogue").classList.contains("hidden")) throw new Error("the dialogue should close on 確定");

// ---------------------------------------------------------------- inventory window
// `I` opens the sheet (there is no packet); it is drawn on the canvas, so the test drives it through
// the same pointer events a player would. The shim never finishes loading art, so only the hit
// testing and the `use` packet are observable here.
elements.get("log").classList.add("hidden");
for (const fn of windowListeners.keydown) fn({ key: "i", preventDefault() {} });
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
// CConfig type0 opens at (24,24); close114,9 is local, not the window origin.
canvasEl.fire("click",surface(24+53,24+64)); // Native default is EQUIP; explicitly select USE.
canvasEl.fire("click", surface(46, 120));
canvasEl.fire("dblclick", surface(46, 120));
const use = sent[sent.length - 1];
console.log("use sent:", JSON.stringify(use));
if (use.t !== "use" || use.slot !== 1 || use.itemId !== 2000000) throw new Error(`bad use: ${JSON.stringify(use)}`);
// Slot 4 holds the map-item sender (2030004), also usable from the USE tab. useBagItem keeps the
// native 200ms consecutive-use gate (nextBagUseAt), so the battery waits it out and then asserts
// the second use really is slot 4 - the old bare log silently showed the stale slot-1 packet.
await new Promise((r) => setTimeout(r, 210));
canvasEl.fire("dblclick", surface(24 + 6 + 3 * 35 + 16, 120));
const mapItemUse = sent[sent.length - 1];
console.log("map item sent:", JSON.stringify(mapItemUse));
if (mapItemUse.t !== "use" || mapItemUse.slot !== 4 || mapItemUse.itemId !== 2030004)
  throw new Error(`bad map item use: ${JSON.stringify(mapItemUse)}`);
// Tab 2 (소비) is the second box: x 36..70, y 52..76.
canvasEl.fire("click", surface(24 + 53, 24 + 64));
// The CLOSE pentagon at the top right closes it again.
clickControl(surface(24 + 130, 24 + 14));
console.log("closed:", (elements.get("inventory")) === undefined ? "no DOM panel" : "unexpected");
// The window was closed by the CLOSE click above; open it again so the frames draw it.
for (const fn of windowListeners.keydown) fn({ key: "i", preventDefault() {} });
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
// Native Stat/AP controls: original sheet, no optimistic stat mutation, pending + 500ms gate.
const statSelf = { ...messages.findLast(m => m.t === "self").self, str:12,dex:5,int:4,luk:4,ap:3,sp:0,fame:0,expToNext:100 };
ws.push({t:"self",self:statSelf});
for(const fn of windowListeners.keydown)fn({key:"s",preventDefault(){}});
await render();assert.equal(elements.get("stat-window").classList.contains("hidden"),false);
// sub_4F3210 enables the SIX AP buttons (ids 2000..2005: STR/DEX/INT/LUK/HP/MP) by AP!=0; the
// pending/500ms gates live in the sender (sub_55CF60), never in the button art (FINDINGS §4.42).
// stat-detail stays disabled until the native basis (character-stats) arrives.
assert.equal(elements.get("ap-maxHp").disabled,false);assert.equal(elements.get("ap-maxMp").disabled,false);assert.equal(elements.get("stat-detail").disabled,true);
assert.equal(elements.get("ap-str").disabled,false);
for(const fn of windowListeners.keydown)fn({key:"s",repeat:true,preventDefault(){}});
assert.equal(elements.get("stat-window").classList.contains("hidden"),false,"key repeat must not flap the window");
const apBefore=sent.filter(m=>m.t==="ability-up").length;
elements.get("ap-str").fire("click");elements.get("ap-dex").fire("click");
assert.deepEqual(sent.at(-1),{t:"ability-up",field:"str"});assert.equal(sent.filter(m=>m.t==="ability-up").length,apBefore+1);
await render();assert.match(elements.get("stat-values").textContent,/STR 12.*AP 3/,"wait for server, not fake +1 locally");
ws.push({t:"self",self:{...statSelf,str:13,ap:2}});ws.push({t:"ability-result",changed:true});
await render();assert.match(elements.get("stat-values").textContent,/STR 13.*AP 2/);
assert.equal(elements.get("ap-dex").disabled,false,"native Update keeps AP buttons visibly enabled during the send cooldown");
elements.get("ap-dex").fire("click");assert.equal(sent.filter(m=>m.t==="ability-up").length,apBefore+1,"500ms send gate survives a fast acknowledgment");
await new Promise(r=>setTimeout(r,510));await render();assert.equal(elements.get("ap-dex").disabled,false);
elements.get("ap-dex").fire("click");ws.push({t:"ability-result",changed:false});
await new Promise(r=>setTimeout(r,510));await render();assert.equal(elements.get("ap-dex").disabled,false,"refusal releases pending");
elements.get("stat-body").fire("mousedown",surface(100,90));
for(const fn of windowListeners.mousemove??[])fn(surface(1000,1000));
for(const fn of windowListeners.mouseup??[])fn({});
assert.deepEqual(JSON.parse(storage.get("kms111.statAt")),{x:624,y:285});
// The frame section above left the inventory open, and main.js's Escape walks the native cascade
// (drag -> inventory -> equip -> stat -> skill -> shop -> dialogue -> system), one window a press.
assert.equal(clientProbe.inventoryOpen,true,"the frame battery leaves the bag open");
for(const fn of windowListeners.keydown)fn({key:"Escape",preventDefault(){}});
assert.equal(clientProbe.inventoryOpen,false,"the first Escape closes the bag, not the stat sheet");
assert.equal(elements.get("stat-window").classList.contains("hidden"),false);
for(const fn of windowListeners.keydown)fn({key:"Escape",preventDefault(){}});
assert.equal(elements.get("stat-window").classList.contains("hidden"),true);
console.log("STAT/AP REGRESSIONS OK");

// ---------------------------------------------------------------- shop regression cases
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
canvasMouseMove(shopPoint(195, 268));
windowMouseUp(shopPoint(195, 268));
canvasEl.fire("click", shopPoint(195, 268)); // native click following a drag is suppressed
assert.equal(clientProbe.scroll.buy, 6);
canvasEl.fire("click", shopPoint(40, 80));
clickControl(shopPoint(100, 40));
elements.get("item-dialog-ok").fire("click");
ws.push({ t: "shop-result", code: 0, message: "silent" });
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
clickControl(shopPoint(306, 40));
assert.equal(sent.length, before);
// A drag released outside the canvas must finish, persist and never leave the button depressed.
canvasEl.fire("mousedown", shopPoint(20, 20));
canvasMouseMove(shopPoint(30, 30));
windowMouseUp(shopPoint(30, 30));
assert.equal(clientProbe.dragging, false);
assert.deepEqual(JSON.parse(storage.get("kms111.shopAt")), { x: 206, y: 164 });
// ADR-064 SOURCE ONLY: native tooltip parsing is separate from dialogue/legacy compact wrapping.
assert.deepEqual(nativeTooltipRows("First\\nSecond", text => text.length * 6, 178), ["First", "Second"]);
const nativePlan=nativeItemTooltip({name:"Potion",desc:"First\\nSecond"},
  {width:text=>text.length*6,height:()=>13});
assert.deepEqual(nativePlan.commands.filter(c=>c.kind==="text").map(c=>c.text),["Potion","First","Second"]);
console.log("SHOP REGRESSIONS OK");

// ---------------------------------------------------------------- failed login and retry
// Isolated at the end so switching the test's stage does not affect the field/Shop assertions above.
elements.get("title-continue").fire("click");
elements.get("user").value = "admin";
elements.get("pass").value = "wrong";
elements.get("login").fire("click");
await new Promise((resolve) => setTimeout(resolve, 5));
sockets.at(-1).push({ t: "login", result: 4, worlds: [] });
assert.equal(elements.get("login").disabled, false);
assert.match(elements.get("status").textContent, /登入失敗/);
assert.equal(clientProbe.dialog, true);
elements.get("pass").value = "admin";
elements.get("login").fire("click");
await new Promise((resolve) => setTimeout(resolve, 5));
const activeSocket = sockets.at(-1);
// Late events from the old socket must not overwrite the retry's state.
sockets[0].emit("close");
assert.equal(elements.get("login").disabled, true);
activeSocket.push({ t: "login", result: 0, worlds: [] });
assert.equal(clientProbe.stage, "worlds");
assert.equal(elements.get("pass").value, "");
assert.equal(elements.get("login").disabled, false);
console.log("TITLE REGRESSIONS OK");

// Original selection windows are canvas art, not immediate-enter HTML cards.
activeSocket.push({ t: "login", result: 0, worlds: [{ name: "Scania", unknownId: 20 }, { name: "Offline", unknownId: 0xffffffff }] });
assert.equal(elements.get("world-connect").disabled, true);
await render();
assert.ok(stamp("UI/Login.img/WorldSelect/menu", 250, 89));
assert.ok(stamp("UI/Login.img/WorldSelect/wsHeader", 274, 270));
let sentAt = sent.length;
elements.get("world-list").children[0].fire("click");
assert.equal(sent.length, sentAt, "row selection does not connect");
assert.equal(elements.get("world-connect").disabled, false);
elements.get("world-list").children[1].fire("click");
assert.equal(elements.get("world-connect").disabled, true, "offline worlds cannot connect");
elements.get("world-list").children[0].fire("click");
elements.get("world-connect").fire("click");
assert.deepEqual(sent.at(-1), { t: "world", index: 0 });
elements.get("world-connect").fire("click");
assert.equal(sent.length, sentAt + 1, "pending double-submit is ignored");
// readLoginCharacters (login-data.ts) validates the FULL CharacterSummary the server sends
// (webclient.ts summaryOf): str/dex/int/luk/face/hair are required, and a malformed entry blocks
// the whole list, so the fixture carries the real wire shape.
activeSocket.push({ t: "characters", result: 0, characters: [
  { id: 21, name: "Hero", level: 2, job: 0, face: 20000, hair: 30000, hp: 50, maxHp: 50, mp: 30, maxMp: 30, exp: 0, mesos: 0, mapId: 0, str: 4, dex: 4, int: 4, luk: 4, items: [] },
  { id: 22, name: "Alt", level: 1, job: 0, face: 21000, hair: 31000, hp: 40, maxHp: 40, mp: 20, maxMp: 20, exp: 0, mesos: 0, mapId: 0, str: 4, dex: 4, int: 4, luk: 4, items: [] },
] });
await render();
assert.ok(stamp("UI/Login.img/CharSelect/menu", 161, 85));
assert.ok(stamp("UI/Login.img/CharSelect/BtSelect/normal/0", 466, 375));
assert.equal(elements.get("character-list").children[0].style.left, "231px");
assert.equal(elements.get("character-list").children[1].style.left, "371px");
sentAt = sent.length;
elements.get("character-list").children[1].fire("click");
assert.equal(sent.length, sentAt, "selecting a character must not enter the field");
elements.get("character-enter").fire("click");
assert.deepEqual(sent.at(-1), { t: "character", id: 22 });
elements.get("character-enter").fire("click");
assert.equal(sent.length, sentAt + 1);
assert.equal(elements.get("character-delete").disabled, true, "all mutations are disabled during field entry");
console.log("SELECTION REGRESSIONS OK");

const tick = (ms=0) => new Promise((resolve)=>setTimeout(resolve,ms));
// Real page/controller, native canvas and hit targets; no socket/network stub may create implicitly.
activeSocket.push({ t: 'characters', result: 0, characters: [
  { id: 21, name: 'Hero', level: 2, job: 0, face: 20000, hair: 30000, hp: 50, maxHp: 50, mp: 30, maxMp: 30, exp: 0, mesos: 0, mapId: 0, str: 4, dex: 4, int: 4, luk: 4, items: [] },
  { id: 22, name: 'Alt', level: 1, job: 0, face: 21000, hair: 31000, hp: 40, maxHp: 40, mp: 20, maxMp: 20, exp: 0, mesos: 0, mapId: 0, str: 4, dex: 4, int: 4, luk: 4, items: [] },
] });
elements.get('character-new').fire('click'); await tick(); await tick();
assert.equal(elements.get('character-dialogs').classList.contains('hidden'), false);
assert.equal(elements.get('new-character').classList.contains('hidden'), true, 'native naming notice precedes the dialog');
elements.get('native-ok').fire('click'); await render();
assert.equal(elements.get('new-character').classList.contains('hidden'), false);
assert.ok(stamp('UI/Login.img/CharSelect/newDlg',270,88));
assert.equal(elements.get('new-name').style.left, '110px');
assert.equal(elements.get('create').style.top, '383px');
elements.get('new-name').value = 'NativeHero'; elements.get('new-name').fire('input');
sentAt = sent.length; elements.get('create').fire('click');
assert.equal(sent.length, sentAt, 'unverified names never create');
elements.get('native-ok').fire('click'); elements.get('check-name').fire('click'); elements.get('check-name').fire('click');
assert.equal(sent.length,sentAt+1,'name checks cannot double-submit');
assert.equal(sent.at(-1).t,'check-name'); assert.equal(sent.at(-1).appearance.length,10);
activeSocket.push({t:'name-checked',name:'NativeHero',result:0}); elements.get('native-ok').fire('click');
elements.get('new-name').value = 'ChangedHero'; elements.get('new-name').fire('input');
sentAt = sent.length; elements.get('create').fire('click'); assert.equal(sent.length,sentAt,'editing invalidates checked name');
elements.get('native-ok').fire('click'); elements.get('check-name').fire('click');
activeSocket.push({t:'name-checked',name:'ChangedHero',result:0}); elements.get('native-ok').fire('click');
elements.get('create-combo-0').fire('click'); elements.get('creation-options').children[2].fire('click');
elements.get('roll-dice').fire('click'); await tick(400); await render();
elements.get('create').fire('click'); elements.get('create').fire('click');
assert.equal(sent.at(-1).t,'create'); assert.equal(sent.at(-1).name,'ChangedHero'); assert.equal(sent.at(-1).appearance[0],20002);
assert.equal(sent.at(-1).appearance.slice(6).reduce((a,b)=>a+b,0),25);
activeSocket.push({t:'characters',result:0,characters:[{ id: 21, name: 'Hero', level: 2, job: 0, face: 20000, hair: 30000, hp: 50, maxHp: 50, mp: 30, maxMp: 30, exp: 0, mesos: 0, mapId: 0, str: 4, dex: 4, int: 4, luk: 4, items: [] },{ id: 22, name: 'Alt', level: 1, job: 0, face: 21000, hair: 31000, hp: 40, maxHp: 40, mp: 20, maxMp: 20, exp: 0, mesos: 0, mapId: 0, str: 4, dex: 4, int: 4, luk: 4, items: [] },{ id: 23, name: 'ChangedHero', level: 1, job: 0, face: 20002, hair: 30000, hp: 40, maxHp: 40, mp: 20, maxMp: 20, exp: 0, mesos: 0, mapId: 0, str: 4, dex: 4, int: 4, luk: 4, items: [] }]});
activeSocket.push({t:'created',ok:true,name:'ChangedHero',id:23});
assert.equal(elements.get('character-dialogs').classList.contains('hidden'),true);
assert.equal(elements.get('character-new').disabled,true,'three slots are full');
elements.get('character-delete').fire('click'); sentAt=sent.length; elements.get('native-no').fire('click');
assert.equal(sent.length,sentAt,'No sends no delete');
elements.get('character-delete').fire('click'); await render();
assert.ok(stamp('UI/Basic.img/YesNo/backgrnd',268,234));
elements.get('native-yes').fire('click'); elements.get('native-yes').fire('click');
assert.equal(sent.length,sentAt+1); assert.deepEqual(sent.at(-1),{t:'delete-character',id:23,confirmed:true});
activeSocket.push({t:'characters',result:0,characters:[{ id: 21, name: 'Hero', level: 2, job: 0, face: 20000, hair: 30000, hp: 50, maxHp: 50, mp: 30, maxMp: 30, exp: 0, mesos: 0, mapId: 0, str: 4, dex: 4, int: 4, luk: 4, items: [] },{ id: 22, name: 'Alt', level: 1, job: 0, face: 21000, hair: 31000, hp: 40, maxHp: 40, mp: 20, maxMp: 20, exp: 0, mesos: 0, mapId: 0, str: 4, dex: 4, int: 4, luk: 4, items: [] }]}); activeSocket.push({t:'deleted',id:23,ok:true});
assert.equal(elements.get('character-dialogs').classList.contains('hidden'),true); assert.equal(elements.get('character-new').disabled,false);
console.log('NATIVE CREATION/DELETION REGRESSIONS OK');

let stopped=false;elements.get("say").value="/where";
elements.get("say").fire("keydown",{key:"Enter",stopPropagation(){stopped=true;}});
assert.equal(stopped,true,"chat Enter must not reopen itself in the bubbling game shortcut handler");
const cmdLines=[];const local=(name,text)=>cmdLines.push(text),oldSent=sent.length;
assert.equal(clientProbe.runCommand("/map 1.5",local),true);assert.equal(sent.length,oldSent);
clientProbe.runCommand("/map 1000000",local);assert.deepEqual(sent.at(-1),{t:"warp-map",mapId:1000000});
clientProbe.runCommand("/map 0",local);assert.deepEqual(sent.at(-1),{t:"warp-map",mapId:0});
clientProbe.runCommand("/help",local);assert.match(cmdLines.at(-1),/maps/);
console.log("PORTAL COMMAND / CHAT FOCUS REGRESSIONS OK");

// Browser inventory gestures are authoritative: no optimistic writes, ack != 0, 500ms.
const equipSelf={...statSelf,characterId:21,mapId:1000000,hp:50,gender:0,level:12};
activeSocket.push({t:'field',mapId:1000000,self:equipSelf,users:[],mobs:[],npcs:[]});
const gear={slot:1,itemId:1002008,ruc:4,cuc:2,stats:{str:3}};
const gearInventory={worn:[],wornCash:[],tabs:[{tab:1,capacity:24,items:[gear]},...[2,3,4].map(tab=>({tab,capacity:24,items:[]}))]};
activeSocket.push({t:'inventory',inventory:gearInventory});
clientProbe.setFacts(gear.itemId,{requirements:{level:30,job:0,str:0,dex:0,int:0,luk:0}});
let gearCount=sent.filter(m=>m.t==='change-slot').length;
await clientProbe.wearItem(gear,1);assert.equal(sent.filter(m=>m.t==='change-slot').length,gearCount,'refusal is a local notice, not a JS error or packet');
clientProbe.setFacts(gear.itemId,{requirements:{level:1,job:0,str:0,dex:0,int:0,luk:0}});
await clientProbe.wearItem(gear,1);assert.deepEqual(sent.at(-1),{t:'change-slot',tab:1,fromSlot:1,toSlot:-1,count:-1});
assert.equal(clientProbe.inventory.worn.length,0,'do not invent successful equipment before 0x0B');
activeSocket.push({t:'inventory',inventory:gearInventory,ack:false});await new Promise(r=>setTimeout(r,510));
await clientProbe.wearItem(gear,1);assert.equal(sent.filter(m=>m.t==='change-slot').length,gearCount+1,'non-ack inventory update must not release pending');
activeSocket.push({t:'inventory',inventory:gearInventory,ack:true});await clientProbe.wearItem(gear,1);assert.equal(sent.filter(m=>m.t==='change-slot').length,gearCount+2);
activeSocket.push({t:'user-enter',user:{characterId:22,name:'Alt',face:20000,avatarItems:[30000],x:100,y:300,action:4,foothold:32}});
const remote=clientProbe.remoteUsers.get('22');remote.probePath={kept:true};
activeSocket.push({t:'user-look',characterId:22,avatarItems:[30000,1002008]});
assert.equal(clientProbe.remoteUsers.get('22'),remote);assert.deepEqual(remote.probePath,{kept:true});assert.equal(remote.face,20000);assert.deepEqual(remote.avatarItems,[30000,1002008]);
console.log('EQUIPMENT REQUIREMENTS / ACK / AUTHORITATIVE LOOK / REMOTE PATH REGRESSIONS OK');

// New skill UI regression source only: not executed for this delivery.
assert.equal(skillRowAt(5,119,8),0);
assert.equal(skillRowAt(158,156,8),0);
assert.equal(skillRowAt(5,157,8),-1,"38px native row, not the two-pixel gap");
assert.equal(skillRowAt(5,158,8),-1);
assert.equal(skillRowAt(5,159,8,2),3);
assert.equal(skillRowAt(5,277,8),-1);
assert.equal(skillRowAt(159,122,8),-1);
const skillFixture={id:1000001,maxLevel:10,requirements:[{skillId:1000000,level:5}]};
assert.equal(skillState(skillFixture,new Map()),0);
assert.equal(skillState(skillFixture,new Map([[1000000,5]])),1);
assert.equal(skillState(skillFixture,new Map([[1000000,5],[1000001,10]])),-1);
clientProbe.skillPanel.toggle(true);await render();
assert.equal(elements.get("skill-window").classList.contains("hidden"),false);
assert.ok(stamp("UI/UIWindow.img/Skill/backgrnd",96,96));
assert.equal(elements.get("sp-up-0").hidden,true,"native beginners have no skill book");
elements.get("skill-close").fire("click");
assert.equal(clientProbe.skillPanel.open,false);
console.log("SKILL BOOK / NATIVE ROW / EMPTY BEGINNER REGRESSION SOURCES OK");

// Recovery model regression sources; do not treat this addition as an executed probe.
const recoverInput={hp:20,maxHp:50,mp:0,maxMp:50,action:2,stationary:true};
const recoverClock={hp:0,mp:0};
for(let i=0;i<333;i++)assert.deepEqual(recoveryTick(recoverClock,recoverInput),[]);
assert.deepEqual(recoveryTick(recoverClock,recoverInput),[{hpDelta:10,flag:0},{mpDelta:3,flag:0}]);
assert.deepEqual(recoveryTick({hp:9990,mp:9990},{...recoverInput,action:0,stationary:false}),[{mpDelta:3,flag:0}]);
assert.deepEqual(recoveryTick({hp:30990,mp:0},{...recoverInput,action:36,climbMs:31000,hpBonus:3}),[{hpDelta:13,flag:1}]);
assert.deepEqual(recoveryTick({hp:9990,mp:9990},{...recoverInput,action:37}),[{mpDelta:3,flag:0}]);
assert.deepEqual(recoveryTick({hp:9990,mp:9990},{...recoverInput,hp:0}),[]);
assert.deepEqual(recoveryTick({hp:9990,mp:9990},{...recoverInput,hp:49,mp:49,rate:1.5,hpBonus:50,mpBonus:32}),[{hpDelta:1,flag:0},{mpDelta:1,flag:0}]);
assert.deepEqual(recoveryTick({hp:9990,mp:9990},{...recoverInput,rate:0}),[]);
assert.deepEqual(recoveryBonuses(100,new Map([[1000000,99],[1000002,1]]),new Map([[1000000,{maxLevel:16,levels:[{level:16,values:{hp:50}}]}],[1000002,{maxLevel:8,levels:[{level:1,values:{time:31}}]}]])),{hpBonus:50,mpBonus:0,climbMs:31000});
// The operator panel must not mutate on open or on merely filling a preset.
const beforeTools=sent.length;
clientProbe.testToolsPanel.openPanel();
assert.deepEqual(sent.at(-1),{t:"test-tools",action:{kind:"state"}});
activeSocket.push({t:"test-tools",enabled:true,canMap:true,checkpoint:false,restoreAvailable:false,message:"source fixture",jobs:[{id:0,name:"초보자"},{id:100,name:"검사"}]});
elements.get("qa-warrior").fire("click");
assert.equal(sent.length,beforeTools+1);
assert.equal(elements.get("qa-apply").disabled,true,"no mutation before explicit confirmation");
elements.get("qa-confirm").checked=true;elements.get("qa-confirm").fire("change");
assert.equal(elements.get("qa-apply").disabled,false);
clientProbe.testToolsPanel.close();
console.log("RECOVERY / EXPLICIT TEST TOOL REGRESSION SOURCES OK");
// The startup guard arms a real 15s timeout timer; every regression above has already run
// synchronously, so exit explicitly instead of idling until that timer fires.
process.exit(0);
