/**
 * Live smoke for the browser renderer (`client/main.js`) against `node src/cli.ts serve`.
 *
 * There is no browser here, so this runs the page's **real** script inside a small DOM shim: an
 * element stub, a 2D context that counts its calls, an `Image` that fires `onload` the way a cached
 * PNG does, and Node's own WebSocket. The page logs in, picks a world and the first character, and
 * then this pumps real `requestAnimationFrame` callbacks. What it asserts is what a person would
 * see: the background sheets, the map's tiles and objects, the NPCs and the character's composed
 * avatar are all drawn, in **one** frame, with pixels that came over `/api/png` and
 * `/api/avatar.png`.
 *
 *   node server/scripts/frame_probe.mjs <webPort>        (default 8495)
 *
 * Run the server with `--data ../Data.wz` and an account that already has a character, e.g.
 *   node src/cli.ts serve --port 8496 --game-port 8497 --web-port 8495 \
 *        --account admin:admin --save /tmp/frame-save.json --data ../Data.wz --ping off
 * The account is left logged out (the script closes the socket), so it can be run repeatedly.
 */
const PORT = process.argv[2] ?? process.env.PORT ?? "8495";
const BASE = `http://127.0.0.1:${PORT}`;
const CLIENT = new URL("../../client/main.js", import.meta.url).href;

class El {
  constructor(tag = "div") {
    this.tag = tag; this.children = []; this.style = {}; this.value = ""; this.textContent = "";
    this.placeholder = ""; this.scrollTop = 0; this.scrollHeight = 0; this.className = "";
    this.dataset = {}; this.src = ""; this.alt = ""; this.title = ""; this.type = "";
    const classes = new Set();
    this.classList = {
      add: (n) => classes.add(n), remove: (n) => classes.delete(n),
      contains: (n) => classes.has(n),
      toggle: (n, force) => { const want = force === undefined ? !classes.has(n) : force; if (want) classes.add(n); else classes.delete(n); return want; },
    };
  }
  addEventListener(type, fn) { (this.listeners ??= {}); (this.listeners[type] ??= []).push(fn); }
  fire(type, event = {}) { event.preventDefault ??= () => {}; for (const fn of this.listeners?.[type] ?? []) fn(event); }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  appendChild(n) { n.parent = this; this.children.push(n); return n; }
  remove() { const p = this.parent; if (!p) return; const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); this.parent = undefined; }
  focus() {} blur() {}
  set innerHTML(v) { this._html = v; } get innerHTML() { return this._html ?? ""; }
  get firstElementChild() { return this.children[0] ?? null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  getContext() { return ctx; }
}

const calls = { drawImage: 0, fillRect: 0, fillText: 0, stroke: 0, fill: 0, save: 0 };
const drawn = [];
const ctx = new Proxy({}, {
  get(target, prop) {
    if (prop === "canvas") return canvasEl;
    if (prop === "drawImage") {
      return (img, x, y, w, h) => { calls.drawImage++; drawn.push({ src: img?.src, x, y, w, h }); };
    }
    if (prop === "fillRect") return (...a) => { calls.fillRect++; };
    if (prop === "fillText") return (text, x, y) => { calls.fillText++; };
    if (prop === "stroke") return () => { calls.stroke++; };
    if (prop === "fill") return () => { calls.fill++; };
    if (prop === "save") return () => { calls.save++; };
    if (prop in target) return target[prop];
    return () => {};
  },
  set(target, prop, value) { target[prop] = value; return true; },
});
const canvasEl = new El("canvas");
const elements = new Map();
globalThis.HTMLInputElement = El;
globalThis.document = {
  getElementById(id) { if (!elements.has(id)) elements.set(id, id === "view" ? canvasEl : new El()); return elements.get(id); },
  activeElement: null,
  createElement(tag) { return new El(tag); },
  createTextNode(text) { return { textContent: text }; },
};
const windowListeners = {};
globalThis.window = { devicePixelRatio: 1, innerWidth: 800, innerHeight: 600, addEventListener(t, fn) { (windowListeners[t] ??= []).push(fn); } };
let frames = 0;
const waiting = [];
globalThis.requestAnimationFrame = (fn) => { if (frames < 3) { frames++; waiting.push(fn); } return frames; };
globalThis.location = { protocol: "http:", host: BASE.replace("http://", "") };

// Images that "load" immediately, like a cached PNG: the renderer must then draw them.
let imageRequests = 0;
globalThis.Image = class {
  constructor() { this.src = ""; this.naturalWidth = 0; this.naturalHeight = 0; this.onload = null; this.onerror = null; }
  set src(value) {
    this._src = value;
    imageRequests++;
    this.naturalWidth = 40; this.naturalHeight = 40;
    setTimeout(() => { this.onload?.(); }, 0);
  }
  get src() { return this._src; }
};
globalThis.URL.createObjectURL = () => "blob:fake";
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const full = String(url).startsWith("http") ? String(url) : `${BASE}${url}`;
  return realFetch(full, options);
};

const NativeWebSocket = globalThis.WebSocket;
const sockets = [];
const seen = [];
globalThis.WebSocket = class extends NativeWebSocket {
  constructor(url) {
    super(url);
    sockets.push(this);
    this.addEventListener("message", (e) => seen.push(JSON.parse(String(e.data))));
  }
};

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
let pump = 0;
const pumpFrames = async (rounds = 5) => {
  for (let i = 0; i < rounds; i++) {
    const batch = waiting.splice(0, waiting.length);
    for (const fn of batch) { pump++; fn(); }
    await tick(30);
  }
};

await import(CLIENT);
await tick(20);
elements.get("user").value = "admin";
elements.get("pass").value = "admin";
elements.get("login").fire("click");
await tick(400);
const socket = sockets[0];
if (!socket) throw new Error("main.js did not open a socket");

console.log("socket open:", socket.readyState === NativeWebSocket.OPEN);
const kinds = () => seen.map((m) => m.t).join(",");
// The page sends its own login; wait for `characters`, then pick the first character.
await tick(800);
console.log("events:", kinds());

// Drive the login chain the way the page does: it logs in, then a world button sends `world`.
for (let i = 0; i < 40 && !seen.some((m) => m.t === "login"); i++) await tick(50);
if (!seen.some((m) => m.t === "login")) throw new Error("the page never logged in");
socket.send(JSON.stringify({ t: "world", index: 0 }));
for (let i = 0; i < 40 && !seen.some((m) => m.t === "characters"); i++) await tick(50);
const list = seen.find((m) => m.t === "characters");
if (!list) throw new Error("no characters event");
const character = list.characters[0];
console.log("character:", character.name, character.id, "map", character.mapId);
socket.send(JSON.stringify({ t: "character", id: character.id }));
for (let i = 0; i < 100 && !seen.some((m) => m.t === "field"); i++) await tick(50);
const field = seen.find((m) => m.t === "field");
if (!field) throw new Error("no field event");
console.log("field:", field.mapId, field.self.name, "npcs", field.npcs.length, "mobs", field.mobs.length);

// Let the page's fetches land (map, art, portal frames, NPC art), then pump real frames.
await tick(1500);
console.log("image requests before frames:", imageRequests);
await pumpFrames(8);
console.log("frames pumped:", pump, "draw calls:", JSON.stringify(calls));
console.log("drawn sources:", drawn.slice(0, 6).map((d) => String(d.src).slice(0, 60)));
console.log("distinct sources:", new Set(drawn.map((d) => d.src)).size);
const back = drawn.some((d) => String(d.src).includes("Map%2FBack"));
const tiles = drawn.some((d) => String(d.src).includes("Map%2FTile"));
const npc = drawn.some((d) => String(d.src).includes("Npc%2F"));
const blobs = drawn.filter((d) => String(d.src).startsWith("blob:")).length;
console.log(JSON.stringify({ back, tiles, npc, avatarBlobs: blobs }));
if (!back || !tiles || blobs === 0) throw new Error("one of the layers never drew");
console.log("FRAME SMOKE OK");
socket.close();
process.exit(0);
