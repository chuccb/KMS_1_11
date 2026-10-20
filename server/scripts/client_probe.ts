/**
 * Offline VM/DOM shim that evaluates the REAL client/main.js (ADR-108 revived it onto the typed
 * module generation with a generic import shim; ADR-109 migrated this probe itself to strict TS).
 * Feature-level native regressions additionally live in server/test/native-chat-gameoptions.test.ts
 * and the typed browser probes.
 *
 * The shim is deliberately minimal: it implements only the DOM/browser contract the client really
 * reads, and every fixture below is either the real wire shape or a real WZ/JSON payload shape.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
// Type-only: erased, so they cost nothing and never evaluate a client module before the shim.
import type { RecoveryInput } from "../../client/recovery.ts";
import type { TooltipFacts } from "../../client/tooltip.ts";

// ------------------------------------------------------------------ shim types
type Listener = (event: DomEvent) => void;

/** The event shape client handlers read; per-event extras (clientX, deltaY, key...) ride along. */
interface DomEvent {
  type?: string;
  target?: ShimElement | null;
  button?: number;
  clientX?: number;
  clientY?: number;
  deltaY?: number;
  key?: string;
  repeat?: boolean;
  shiftKey?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
  [field: string]: unknown;
}

interface ClassList {
  add(name: string): void;
  remove(name: string): void;
  contains(name: string): boolean;
  toggle(name: string, force?: boolean): boolean;
}

/** A type alias (not an interface) so it keeps the implicit index signature DomEvent accepts. */
type PointerPoint = {
  clientX: number;
  clientY: number;
};

/** Offline DOM/canvas shim: does client/main.js run, and do its handlers survive real event shapes? */
class ShimElement {
  tag: string;
  id?: string;
  parent?: ShimElement;
  children: ShimElement[] = [];
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  value = "";
  textContent = "";
  placeholder = "";
  scrollTop = 0;
  scrollHeight = 0;
  className = "";
  src = "";
  alt = "";
  title = "";
  type = "";
  hidden = false;
  disabled = false;
  checked = false;
  validationMessage = "";
  listeners?: Record<string, Listener[]>;
  attributes?: Record<string, string>;
  classList: ClassList;
  // Zeroed box metrics: chatlog.ts clamps with scrollHeight-clientHeight and display-controls.ts
  // falls back to window.innerWidth/Height when clientWidth is 0 - both real-browser behaviors.
  clientWidth = 0;
  clientHeight = 0;
  private html?: string;
  private queries?: Map<string, ShimElement>;

  constructor(tag = "div") {
    this.tag = tag;
    const classes = new Set<string>();
    this.classList = {
      add: (name) => void classes.add(name),
      remove: (name) => void classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const want = force === undefined ? !classes.has(name) : force;
        if (want) classes.add(name);
        else classes.delete(name);
        return want;
      },
    };
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners ??= {};
    (this.listeners[type] ??= []).push(listener);
  }

  fire(type: string, event: DomEvent = {}): void {
    event.preventDefault ??= () => {};
    let stopped = false;
    event.stopPropagation ??= () => {
      stopped = true;
    };
    // Delegated handlers (login-screen world/character rows, player-menu) read event.target and
    // closest("button"), so events carry the browser's target and bubble up the shim parent chain
    // exactly like the DOM; stopPropagation really stops the walk.
    event.target ??= this;
    // A real MouseEvent defaults to the primary button; typed handlers (e.g. login-screen.ts)
    // gate on event.button === 0, so the shim must deliver the browser's default event shape.
    if (
      /^(?:click|auxclick|mousedown|mouseup|mouseenter|mouseleave|mousemove|pointerdown|pointerup|pointermove|pointercancel)$/.test(
        type,
      )
    )
      event.button ??= 0;
    let node: ShimElement | undefined = this;
    while (node && !stopped) {
      for (const listener of node.listeners?.[type] ?? []) {
        listener(event);
        if (stopped) break;
      }
      node = node.parent;
    }
  }

  append(...nodes: ShimElement[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: ShimElement[]): void {
    // Detached children lose the parent link; kept ones gain it - delegated handlers and the
    // bubbling fire() walk this chain (login-screen.ts rebuilds rows with replaceChildren).
    for (const child of this.children) if (child.parent === this) child.parent = undefined;
    for (const node of nodes) node.parent = this;
    this.children = [...nodes];
  }

  appendChild(node: ShimElement): ShimElement {
    node.parent = this;
    this.children.push(node);
    return node;
  }

  // ChildNode.before: chatlog.ts re-renders a message group in place with old[0].before(...rows).
  before(...nodes: ShimElement[]): void {
    const parent = this.parent;
    if (!parent) return;
    let index = parent.children.indexOf(this);
    if (index < 0) return;
    for (const node of nodes) {
      node.parent = parent;
      parent.children.splice(index++, 0, node);
    }
  }

  remove(): void {
    const parent = this.parent;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parent = undefined;
  }

  focus(): void {
    shimDocument.activeElement = this;
  }
  blur(): void {
    if (shimDocument.activeElement === this) shimDocument.activeElement = null;
  }
  select(): void {}
  setCustomValidity(value: string): void {
    this.validationMessage = value;
  }

  setAttribute(name: string, value: string): void {
    (this.attributes ??= {})[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes?.[name] ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes ? name in this.attributes : false;
  }
  removeAttribute(name: string): void {
    if (this.attributes) delete this.attributes[name];
  }

  get parentElement(): ShimElement | null {
    return this.parent ?? null;
  }

  // The tag/id/attribute/class selectors the client's delegated handlers actually use
  // (closest("button") in login-screen/player-menu/skills, [data-x] in chatlog/lens-controls).
  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const sel = part.trim();
      if (sel.startsWith("#")) return this.id === sel.slice(1);
      if (sel.startsWith("[")) return this.hasAttribute(sel.slice(1, -1).split("=")[0]);
      if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
      return this.tag === sel;
    });
  }

  closest(selector: string): ShimElement | null {
    let node: ShimElement | undefined = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return null;
  }

  contains(node: ShimElement | null): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }

  set innerHTML(value: string) {
    this.html = value;
  }
  get innerHTML(): string {
    return this.html ?? "";
  }
  get firstElementChild(): ShimElement | null {
    return this.children[0] ?? null;
  }

  getContext(): CanvasRenderingContext2D {
    return ctxStub;
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 800, height: 600 };
  }
  get localName(): string {
    return this.tag;
  }
  // scene-surface.ts builds its render buffer through canvas.ownerDocument.createElement.
  get ownerDocument(): ShimDocument {
    return shimDocument;
  }
  // client/dom.ts requireQuery validates localName, so selector hits must carry the REAL tag the
  // selector has in index.html; per-element caching keeps repeated queries referentially stable.
  querySelector(selector: string): ShimElement {
    const cached = (this.queries ??= new Map());
    if (!cached.has(selector)) cached.set(selector, new ShimElement(shimTagFor(selector)));
    const found = cached.get(selector);
    if (!found) throw new Error(`client_probe: querySelector(${selector}) produced nothing`);
    return found;
  }
}

// The real index.html schema drives shim tags: requireElement/requireQuery (client/dom.ts) check
// localName against the tag each id/data-selector actually has in the shipped document. Parsing
// the document keeps this shim from rotting into another hardcoded allowlist.
const indexHtml = readFileSync(new URL("../../client/index.html", import.meta.url), "utf8");
const shimTagById = new Map<string, string>();
const shimTagByData = new Map<string, string>();
for (const chunk of indexHtml.split("<").slice(1)) {
  const tagSource = chunk.split(">")[0];
  const tag = /^[a-z0-9]+/.exec(tagSource)?.[0];
  if (!tag) continue;
  const id = /\bid="([^"]+)"/.exec(tagSource)?.[1];
  if (id) shimTagById.set(id, tag);
  for (const data of tagSource.matchAll(/\b(data-[a-z0-9-]+)/g)) shimTagByData.set(data[1], tag);
}
function shimTagFor(selector: string): string {
  if (selector.startsWith("#")) return shimTagById.get(selector.slice(1)) ?? "div";
  const data = /^\[(data-[a-z0-9-]+)(?:=[^\]]*)?\]$/.exec(selector)?.[1];
  if (data) return shimTagByData.get(data) ?? "div";
  return "div";
}

// ------------------------------------------------------------------ canvas shim
const canvasEl = new ShimElement("canvas");
canvasEl.id = "view";
let drawImageCalls = 0;
interface DrawCall {
  src: string | undefined;
  x: number;
  y: number;
}
const drawn: DrawCall[] = [];
const ctxStub = new Proxy({} as Record<string, unknown>, {
  get(target: Record<string, unknown>, prop: string | symbol) {
    if (prop === "canvas") return canvasEl;
    if (prop === "measureText") return (text: string) => ({ width: String(text).length * 6 });
    if (prop === "drawImage")
      return (image: { src?: string }, x: number, y: number) => {
        drawImageCalls += 1;
        drawn.push({ src: image?.src, x, y });
      };
    if (!(prop in target)) target[prop as string] = () => {};
    return target[prop as string];
  },
  set(target: Record<string, unknown>, prop: string | symbol, value: unknown) {
    target[prop as string] = value;
    return true;
  },
}) as unknown as CanvasRenderingContext2D;

// ------------------------------------------------------------------ document / window shim
const elements = new Map<string, ShimElement>();
const documentListeners: Record<string, Listener[]> = {};
interface ShimDocument {
  documentElement: ShimElement;
  activeElement: ShimElement | null;
  // client/pointer.ts releases pressed pointers on visibilitychange through these.
  // movementBlocked() (main.js) gates input on the page being visible AND focused; the probe
  // drives a foreground page, so hasFocus mirrors a focused document.
  hidden: boolean;
  hasFocus(): boolean;
  getElementById(id: string): ShimElement;
  createElement(tag: string): ShimElement;
  createTextNode(text: string): { textContent: string };
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  dispatchEvent(event: DomEvent): boolean;
}
const shimDocument: ShimDocument = {
  documentElement: new ShimElement("html"),
  activeElement: null,
  hidden: false,
  hasFocus: () => true,
  getElementById(id) {
    if (!elements.has(id)) {
      const element = id === "view" ? canvasEl : new ShimElement(shimTagById.get(id) ?? "div");
      element.id ??= id;
      elements.set(id, element);
    }
    const found = elements.get(id);
    if (!found) throw new Error(`client_probe: getElementById(${id}) produced nothing`);
    return found;
  },
  createElement(tag) {
    return new ShimElement(tag);
  },
  createTextNode(text) {
    return { textContent: text };
  },
  addEventListener(type, listener) {
    (documentListeners[type] ??= []).push(listener);
  },
  removeEventListener(type, listener) {
    const list = documentListeners[type];
    const index = list?.indexOf(listener) ?? -1;
    if (index >= 0) list?.splice(index, 1);
  },
  dispatchEvent(event) {
    for (const listener of documentListeners[event.type ?? ""] ?? []) listener(event);
    return true;
  },
};
/** Indexed element with a real error instead of an undefined dereference. */
function el(id: string): ShimElement {
  return shimDocument.getElementById(id);
}

const windowListeners: Record<string, Listener[]> = {};
interface ShimWindow {
  devicePixelRatio: number;
  innerWidth: number;
  innerHeight: number;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  dispatchEvent(event: DomEvent): boolean;
}
const shimWindow: ShimWindow = {
  devicePixelRatio: 1,
  innerWidth: 800,
  innerHeight: 600,
  addEventListener(type, listener) {
    (windowListeners[type] ??= []).push(listener);
  },
  removeEventListener(type, listener) {
    const list = windowListeners[type];
    const index = list?.indexOf(listener) ?? -1;
    if (index >= 0) list?.splice(index, 1);
  },
  // main.js's last statement dispatches CLIENT_READY_EVENT; the startup guard (startup-guard.ts)
  // flips documentElement.dataset.clientState to "ready" through this synchronous delivery.
  dispatchEvent(event) {
    for (const listener of windowListeners[event.type ?? ""] ?? []) listener(event);
    return true;
  },
};
/** Faithful window delivery: the event object is handed over exactly as the caller built it. */
function emitWindow(type: string, event: DomEvent = {}): void {
  for (const listener of windowListeners[type] ?? []) listener(event);
}

// Real browser delivery for canvas interaction (ADR-108): a mouseup/mousemove over the canvas
// bubbles to the WINDOW listeners main.js uses for sprite-button activation and window drags, and
// native CCtrlButton controls (shop buy/sell/close, inventory close, status, trade) activate only
// when the full mousedown -> mouseup -> click trio lands on the same control. Rows, tabs and
// scrollbars are not controls and stay bare clicks.
function windowMouseUp(point: Partial<DomEvent> = {}): void {
  emitWindow("mouseup", {
    button: 0,
    target: canvasEl,
    preventDefault() {},
    stopPropagation() {},
    ...point,
  });
}
function canvasMouseMove(point: PointerPoint): void {
  canvasEl.fire("mousemove", { ...point });
  emitWindow("mousemove", { ...point, target: canvasEl });
}
function clickControl(point: PointerPoint): void {
  canvasEl.fire("mousedown", { ...point });
  windowMouseUp(point);
  canvasEl.fire("click", { ...point });
}

// ------------------------------------------------------------------ browser globals
// Installed before ANY client module is imported: client module scope reads these directly.
const globals = globalThis as unknown as Record<string, unknown>;
globals.HTMLInputElement = ShimElement;
// login-screen/player-menu guard delegated clicks with instanceof Element/HTMLButtonElement.
globals.Element = ShimElement;
globals.HTMLElement = ShimElement;
globals.HTMLButtonElement = ShimElement;
globals.document = shimDocument;
globals.window = shimWindow;
globals.Event = class {
  type: string;
  constructor(type: string, init: DomEvent = {}) {
    this.type = type;
    Object.assign(this, init);
  }
};
globals.performance = { now: () => Date.now() };
const storage = new Map<string, string>();
globals.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
};
let frameCallback: ((time: number) => void) | undefined;
globals.requestAnimationFrame = (callback: (time: number) => void): number => {
  frameCallback = callback;
  return 1;
};
globals.location = { protocol: "http:", host: "127.0.0.1:8500" };
// The picture stack: a canvas never finishes loading here, so the renderer must not need it.
globals.Image = class {
  width = 32;
  height = 32;
  naturalWidth = 32;
  naturalHeight = 32;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private source = "";
  set src(value: string) {
    this.source = value;
    // An image "loads" when a source is assigned; the probe never needs real pixels.
    setTimeout(() => this.onload?.(), 0);
  }
  get src(): string {
    return this.source;
  }
};

// ------------------------------------------------------------------ server fixture payloads
const STUB_MAP = {
  id: 1000000,
  name: "stub",
  streetName: "stub",
  portals: [
    { name: "sp", type: 0, x: -91, y: 181, toMapId: 999999999 },
    { name: "door", type: 2, x: 200, y: 181, toMapId: 1010000 },
  ],
  footholds: [{ id: 32, x1: 0, y1: 300, x2: 1000, y2: 300, next: 0, prev: 0 }],
  // The real /api/map JSON lists its NPCs (webclient.ts mapPayload), and loadMap preloads their
  // metadata from exactly this list; the stub carries the one template the NPC battery clicks.
  mobs: [],
  npcs: [{ templateId: 2003, x: 300, y: 420, foothold: 32 }],
};
const STUB_ART = {
  backs: [
    {
      path: "Map/Back/x.img/back/0",
      ox: 128,
      oy: 128,
      x: 0,
      y: 0,
      rx: 0,
      ry: 0,
      type: 0,
      cx: 0,
      cy: 0,
      a: 255,
      front: 0,
      flip: 0,
    },
  ],
  sprites: [
    {
      kind: "tile",
      layer: 0,
      x: 0,
      y: 0,
      z: -500,
      flip: 0,
      frames: [{ path: "Map/Tile/x.img/a/0", delay: 0, ox: 0, oy: 0 }],
    },
  ],
  bounds: { left: 0, top: 0, right: 1000, bottom: 692 },
};
interface JsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
const ok = (body: unknown): JsonResponse => ({ ok: true, status: 200, json: async () => body });
const shimFetch = async (url: string | URL | Request): Promise<JsonResponse> => {
  const path = String(url);
  if (path === "/api/maps") return ok([STUB_MAP]);
  if (path.startsWith("/api/skills/")) return ok({ job: 0, books: [] });
  if (path === "/api/creation") {
    const make = (sets: number[][]) =>
      sets.map((set) => set.map((id) => ({ id, name: `option ${id}` })));
    // isCreationCatalog (ui-resource-validation.ts) also requires the WZ ForbiddenName list.
    return ok({
      forbidden: [],
      male: make([
        [20000, 20001, 20002],
        [30030, 30020, 30000],
        [1040002, 1040006, 1040010],
        [1060002, 1060006],
        [1072001, 1072005],
        [1302000, 1322005, 1312004],
      ]),
      female: make([
        [21000, 21001, 21002],
        [31000, 31040, 31054],
        [1041002, 1041006, 1041010, 1041011],
        [1061002, 1061008],
        [1072001, 1072005],
        [1302000, 1322005, 1312004],
      ]),
    });
  }
  if (path.endsWith("/art")) return ok(STUB_ART);
  // isNpcMetadata (entity-resource-validation.ts) requires the full record; the click rectangle is
  // the server's own native dc* fallback (npcClickBounds, sprites.ts), not an invented hit box.
  if (path.startsWith("/api/npc/"))
    return ok({
      templateId: 2003,
      name: "NPC",
      behavior: { movable: false, speak: [], extraActions: [] },
      clickBounds: { left: -22, top: -65, right: 22, bottom: 0 },
      actions: { stand: [{ path: "Npc/0002003.img/stand/0", delay: 1000, ox: 20, oy: 40 }] },
    });
  if (path.startsWith("/api/mob/"))
    return ok({
      templateId: 1210100,
      actions: { move: [{ path: "Mob/0121010.img/move/0", delay: 180, ox: 20, oy: 40 }] },
    });
  return ok(STUB_MAP);
};
globals.fetch = shimFetch;

// ------------------------------------------------------------------ transport shim
interface SentPacket {
  t: string;
  [field: string]: unknown;
}
const sent: SentPacket[] = [];
class ShimSocket {
  static OPEN = 1;
  readyState = 1;
  private listeners: Record<string, Listener[]> = {};
  constructor() {
    sockets.push(this);
    setTimeout(() => this.emit("open"), 0);
  }
  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }
  emit(type: string, event: DomEvent = {}): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
  send(text: string): void {
    sent.push(JSON.parse(text) as SentPacket);
  }
  close(): void {}
  /** Server push: the only direction a real server uses to reach the client. */
  push(message: WireMessage): void {
    this.emit("message", { data: JSON.stringify(message) });
  }
}
const sockets: ShimSocket[] = [];
globals.WebSocket = ShimSocket;
// main.js's ordered local controller; the probe advances it by hand (intervals.at(-1)).
const intervals: (() => void)[] = [];
globals.setInterval = (callback: () => void): number => {
  intervals.push(callback);
  return intervals.length;
};

// ------------------------------------------------------------------ main.js evaluation
// ADR-108 generic import shim: main.js's own top-level `import {a, b} from "./mod.ts"` lines are
// stripped and each requested binding is exposed as a global from the REAL module - exactly the
// free-identifier contract classic-script evaluation needs, for every module main.js actually
// imports. The former hardcoded strip list only knew the .mjs generation and rotted with every
// module split, which is why this probe was stuck while main.js moved on to ~90 typed modules.
const mainUrl = new URL("../../client/main.js", import.meta.url);
let mainSource = readFileSync(mainUrl, "utf8");
const mainImports: [names: string, specifier: string][] = [];
mainSource = mainSource.replace(
  /^import\s*\{([^}]*)\}\s*from\s*["'](\.\/[^"']+)["'];?[ \t]*\r?\n/gm,
  (statement: string, names: string, specifier: string) => {
    mainImports.push([names, specifier]);
    // Blank the statement but keep its newlines so vm stack traces match client/main.js lines.
    return statement.replace(/[^\n]/g, "");
  },
);
if (/^import[\s{*]/m.test(mainSource))
  throw new Error("client_probe: unrecognized import form in client/main.js");
for (const [names, specifier] of mainImports) {
  const module: Record<string, unknown> = await import(new URL(specifier, mainUrl).href);
  for (const entry of names.split(",")) {
    const name = entry.trim();
    if (!name) continue;
    const [exported, local = exported] = name.split(/\s+as\s+/).map((part) => part.trim());
    if (!(exported in module))
      throw new Error(`client_probe: ${specifier} does not export ${exported}`);
    globals[local] = module[exported];
  }
}

/** The typed rules the probe asserts in its own scope (not through main.js's free identifiers). */
const { skillRowAt, skillState } = await import("../../client/skills.ts");
const { nativeItemTooltip, nativeTooltipRows } = await import("../../client/tooltip.ts");
const { recoveryBonuses, recoveryTick } = await import("../../client/recovery.ts");

// index.html loads two ordered module entries: ./startup.ts (installs the startup guard, which
// gates every login attempt through documentElement.dataset.clientState) and then ./main.js.
// The probe reproduces that order; main.js's final dispatchEvent flips the guard to "ready".
await import("../../client/startup.ts");

/** main.js internals the probe observes; the epilogue below installs exactly this contract. */
interface ClientProbe {
  readonly stage: string;
  readonly dialog: boolean;
  readonly inventoryOpen: boolean;
  readonly itemDialog: { open: boolean };
  readonly inventory: { worn: unknown[] };
  readonly remoteUsers: Map<string, RemoteUser>;
  readonly scroll: { buy: number; sell: number };
  readonly picked: { itemId: number } | undefined;
  readonly dragging: boolean;
  shopRowsOf(pane: string): unknown[];
  shopWindowAt(x: number, y: number): { kind: string };
  shopScrollbarGeometry(pane: string): { offset: number };
  runCommand(line: string, local: (name: string, text: string) => void): boolean;
  skillPanel: { toggle(open: boolean): void; readonly open: boolean };
  testToolsPanel: { openPanel(): void; close(): void };
  setFacts(id: number, facts: TooltipFacts): void;
  wearItem(item: ProbeGear, tab: number): Promise<void>;
}
interface RemoteUser {
  face: number;
  avatarItems: number[];
  probePath?: { kept: boolean };
}
interface ProbeGear {
  slot: number;
  itemId: number;
  ruc: number;
  cuc: number;
  stats: Record<string, number>;
}
runInThisContext(
  `${mainSource}
;globalThis.clientProbe = {
  testToolsPanel, skillPanel, itemDialog, wearItem,
  get inventory() { return inventory; },
  get remoteUsers() { return users; },
  runCommand, shopRowsOf, shopScrollbarGeometry, shopWindowAt,
  get scroll() { return { ...shopScroll }; },
  get picked() { return shopSellPick; },
  get dragging() { return shopDrag !== undefined || shopScrollDrag !== undefined; },
  // The typed login UI (login-screen.ts) owns title/selection state since its module round;
  // main.js holds it as loginScreens, whose getters are the probe's observation points.
  get stage() { return loginScreens.stage; },
  get dialog() { return loginScreens.titleDialogOpen; },
  get inventoryOpen() { return inventoryOpen; },
  setFacts(id, facts) { itemInfo.set(id, facts); },
};`,
  { filename: "client/main.js" },
);
const probe = globals.clientProbe as ClientProbe | undefined;
if (!probe) throw new Error("client_probe: main.js did not publish the probe contract");
await new Promise((resolve) => setTimeout(resolve, 10));

// Title and modal are drawn at original coordinates, and use the WZ button state sprites.
const render = async (): Promise<void> => {
  frameCallback?.(Date.now());
  await new Promise((resolve) => setTimeout(resolve, 5));
  frameCallback?.(Date.now());
};
const stamp = (path: string, x: number, y: number): boolean =>
  drawn.some(
    (call) => decodeURIComponent(call.src ?? "").endsWith(path) && call.x === x && call.y === y,
  );

// ------------------------------------------------------------------ title screen
assert.equal(probe.stage, "title");
assert.equal(probe.dialog, false);
await render();
assert.ok(stamp("UI/Login.img/Title/backgrnd", 0, 0));
assert.ok(stamp("UI/Login.img/Title/menu", 302, 358));
assert.ok(stamp("UI/Login.img/Title/BtContinue/normal/0", 356, 423));
el("title-continue").fire("mouseenter");
await render();
assert.ok(stamp("UI/Login.img/Title/BtContinue/mouseOver/0", 356, 423));
el("title-continue").fire("mousedown");
await render();
assert.ok(stamp("UI/Login.img/Title/BtContinue/pressed/0", 356, 423));
el("title-continue").fire("click");
assert.equal(probe.dialog, true);
assert.equal(el("title-menu").classList.contains("hidden"), true);
await render();
assert.ok(stamp("UI/Login.img/Title/loginDlg", 247, 215));
assert.ok(stamp("UI/Basic.img/BtOK/normal/0", 373, 342));
el("pass").value = "must-clear";
emitWindow("keydown", { key: "Escape" });
assert.equal(probe.dialog, false);
assert.equal(el("pass").value, "");
el("title-continue").fire("click");
// A focused login field owns Enter and I; they must not activate chat or the inventory.
shimDocument.activeElement = el("user");
emitWindow("keydown", { key: "i" });
assert.equal(probe.inventoryOpen, false);
shimDocument.activeElement = null;
el("remember-user").checked = true;
el("user").value = "admin";
el("pass").value = "admin";
el("login").fire("click");
el("login").fire("click"); // duplicate press is ignored while pending
assert.equal(sockets.length, 1);
assert.equal(el("user").disabled, true);
await render();
assert.ok(stamp("UI/Basic.img/BtOK/disabled/0", 373, 342));
await new Promise((resolve) => setTimeout(resolve, 10));
const socket = sockets[0];
if (!socket) throw new Error("main.js did not open a socket");

// ------------------------------------------------------------------ transport battery
interface WireMessage {
  t: string;
  [field: string]: unknown;
}
const messages: WireMessage[] = [
  { t: "login", result: 0, worlds: [{ name: "Scania", unknownId: 0 }] },
  {
    t: "characters",
    result: 0,
    characters: [
      {
        id: 21,
        name: "Hero",
        level: 12,
        job: 0,
        face: 20000,
        hair: 30000,
        hp: 50,
        maxHp: 50,
        mp: 30,
        maxMp: 30,
        exp: 0,
        mesos: 200,
        mapId: 1000000,
        str: 4,
        dex: 4,
        int: 4,
        luk: 4,
        items: [],
      },
    ],
  },
  {
    t: "field",
    mapId: 1000000,
    self: {
      characterId: 21,
      name: "Hero",
      level: 12,
      job: 0,
      hp: 50,
      maxHp: 50,
      mp: 30,
      maxMp: 30,
      exp: 0,
      mesos: 200,
      mapId: 1000000,
      face: 20000,
    },
    users: [],
    mobs: [],
    npcs: [],
  },
  {
    t: "user-enter",
    user: {
      characterId: 22,
      name: "Alt",
      face: 20000,
      avatarItems: [],
      x: 10,
      y: 20,
      action: 0,
      foothold: 0,
    },
  },
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
  {
    t: "self",
    self: {
      characterId: 21,
      name: "Hero",
      level: 13,
      job: 0,
      hp: 40,
      maxHp: 60,
      mp: 20,
      maxMp: 40,
      exp: 5,
      mesos: 150,
      mapId: 1000000,
      face: 20000,
    },
  },
  { t: "unknown", opcode: 0x42, bytes: 3 },
  { t: "user-leave", characterId: 22 },
  { t: "disconnect", reason: "closed" },
  { t: "created", ok: true, name: "Rookie", id: 9 },
  { t: "created", ok: false, name: "Rookie", reason: "name check 1" },
  { t: "error", message: "boom" },
];
for (const message of messages) socket.push(message);
assert.equal(el("pass").value, "");
assert.equal(storage.get("kms111.loginUser"), "admin");
assert.equal(probe.stage, "game");
assert.equal(el("title-ui").classList.contains("hidden"), true);
assert.ok(![...storage.values()].some((value) => value.includes("password")));
await new Promise((resolve) => setTimeout(resolve, 50));
emitWindow("keydown", { key: "ArrowRight", preventDefault() {} });
const physicsTick = intervals.at(-1);
if (!physicsTick) throw new Error("main.js did not schedule its local controller interval");
physicsTick();
await new Promise((resolve) => setTimeout(resolve, 10));
// The emote bar: seven buttons, one per F-key face (1..7).
const buttons = el("emotes").children;
console.log(
  "emote buttons:",
  buttons.length,
  buttons.map((button) => button.textContent).join(","),
);
buttons[2].fire("click"); // 1,2,3 -> "smile"

el("new-name").value = "Rookie";
// Creation is now a modal checked-name workflow, tested separately below.
el("say").value = "hi there";
el("say").fire("keydown", { key: "Enter", shiftKey: false });

// /w keeps the typed line (the wire's answer carries no text) and prints "name<< text" on delivery.
el("say").value = "/w Alt hi there";
el("say").fire("keydown", { key: "Enter", shiftKey: false });
socket.push({ t: "whisper-answer", name: "Alt", delivered: true });
socket.push({ t: "whisper-answer", name: "Nobody", delivered: false });
el("say").value = "/f Hero";
el("say").fire("keydown", { key: "Enter", shiftKey: false });
socket.push({ t: "find-answer", name: "Hero", mapId: 1000000 });
socket.push({ t: "find-answer", name: "Nobody", mapId: -1 });
el("say").value = "/x nope";
el("say").fire("keydown", { key: "Enter", shiftKey: false });
el("say").value = "/w Alt";
el("say").fire("keydown", { key: "Enter", shiftKey: false });
await new Promise((resolve) => setTimeout(resolve, 10));
await new Promise((resolve) => setTimeout(resolve, 10));
console.log("after input:", JSON.stringify(sent));
const chatHtml = el("chat-lines").children.map((line) => line.textContent);
console.log("chat lines:", JSON.stringify(chatHtml));
// `field` already fetched map 1000000, so a find answer for it carries the name...
el("say").value = "/f Hero";
el("say").fire("keydown", { key: "Enter", shiftKey: false });
socket.push({ t: "find-answer", name: "Hero", mapId: 1000000 });
// ADR-059: an uncached map starts with an explicit id, then asynchronously loads street:map.
socket.push({ t: "find-answer", name: "Hero", mapId: 2000000 });
await new Promise((resolve) => setTimeout(resolve, 10));
const later = el("chat-lines").children.map((line) => line.textContent);
console.log("find lines:", JSON.stringify(later.slice(-2)));

// The transport battery above ends with disconnect/created/error on purpose, and every one of
// those bumps mapGeneration (main.js's stale-map guard), which voids the first field's async
// loadMap. A real reconnect re-enters the field, so the gameplay batteries do the same and wait
// for the map JSON before clicking portals.
socket.push({
  t: "field",
  mapId: 1000000,
  self: {
    characterId: 21,
    name: "Hero",
    level: 12,
    job: 0,
    hp: 50,
    maxHp: 50,
    mp: 30,
    maxMp: 30,
    exp: 0,
    mesos: 200,
    mapId: 1000000,
    face: 20000,
  },
  users: [],
  mobs: [],
  npcs: [],
});
await new Promise((resolve) => setTimeout(resolve, 20));

// ------------------------------------------------------------------ portal click
// The portal hit test, with the camera where main.js puts it: self at the centre of 800x600, then
// clamped to the map's rectangle (the stub map is 1000x692, so x is clamped and y is too).
const cameraX = Math.max(0, Math.min(1000 - 800, 0 - 800 / 2));
const cameraY = Math.max(0, Math.min(692 - 600, 0 - 600 / 2));
const doorX = 200 - cameraX;
const doorY = 181 - cameraY;
canvasMouseMove({ clientX: doorX, clientY: doorY });
canvasEl.fire("click", { clientX: doorX, clientY: doorY });
canvasMouseMove({ clientX: 5, clientY: 5 });
const last = sent.at(-1);
if (JSON.stringify(last) !== JSON.stringify({ t: "portal", name: "door" }))
  throw new Error(`no portal sent: ${JSON.stringify(last)}`);
canvasEl.fire("click", { clientX: doorX, clientY: doorY }); // inside the 600 ms gate: must not send twice
if (sent.filter((packet) => packet.t === "portal").length !== 1)
  throw new Error("the portal guard did not hold");
console.log("portal click ok:", JSON.stringify(last));
// A real server answers the portal request with the destination field, and portalPending (which
// gates item use, attacks and further portals) only clears on that map change. Answer it the way
// the wire does before the gameplay batteries continue.
socket.push({
  t: "field",
  mapId: 1010000,
  self: {
    characterId: 21,
    name: "Hero",
    level: 12,
    job: 0,
    hp: 50,
    maxHp: 50,
    mp: 30,
    maxMp: 30,
    exp: 0,
    mesos: 200,
    mapId: 1010000,
    face: 20000,
  },
  users: [],
  mobs: [],
  npcs: [],
});
await new Promise((resolve) => setTimeout(resolve, 20));
if (el("status").textContent === "" && !el("status").innerHTML) console.log("note: status empty");
console.log("status:", JSON.stringify(el("status").textContent || el("status").innerHTML));
console.log("chat input placeholder:", JSON.stringify(el("say").placeholder));
console.log("where:", JSON.stringify(el("where").textContent));
console.log("chat lines:", JSON.stringify(el("chat-lines").innerHTML));

// ------------------------------------------------------------------ NPC click
// An NPC standing where the camera says, so `npcAt` can find it: the page's hit box is 18x34 above
// the ground point, plus slack.
const npcScreenX = 300;
const npcScreenY = 420;
// Put the local character at a known place first (`self` follows its own `user-move`), so the
// camera is exactly (0 - 400, 0 - 300) clamped to the stub map and `screen = world - camera` can be
// inverted here.
socket.push({ t: "user-move", characterId: 21, x: 0, y: 0, action: 0, foothold: 0 });
const npcCameraX = Math.max(0, Math.min(1000 - 800, 0 - 400));
const npcCameraY = Math.max(0, Math.min(692 - 600, 0 - 300));
socket.push({
  t: "npc-enter",
  npc: {
    npcId: 7,
    templateId: 2003,
    x: npcScreenX + npcCameraX,
    y: npcScreenY + npcCameraY,
    facing: 0,
  },
});
// The hit rectangle comes from the NPC's OWN metadata (info.dc*): wait for the async load, then
// hit-test through the click packet. 70f9405 restored the native arrow cursor, so hovering an NPC
// no longer repaints a CSS pointer; the sent packet is the observable contract.
await new Promise((resolve) => setTimeout(resolve, 20));
canvasMouseMove({ clientX: npcScreenX, clientY: npcScreenY - 20 });
canvasEl.fire("click", { clientX: npcScreenX, clientY: npcScreenY - 20 });
const clickSent = sent.at(-1);
console.log("npc click:", JSON.stringify(clickSent));
if (clickSent?.t !== "click" || clickSent.objectId !== 7)
  throw new Error(`bad npc click: ${JSON.stringify(clickSent)}`);

// ------------------------------------------------------------------ shop & dialogue
// The sell pane reads the open inventory, so the player has a potion there before the shop opens.
socket.push({
  t: "inventory",
  inventory: {
    worn: [],
    wornCash: [],
    tabs: [
      { tab: 1, capacity: 24, items: [] },
      { tab: 2, capacity: 24, items: [{ slot: 1, itemId: 2000000, quantity: 3 }] },
      { tab: 3, capacity: 24, items: [] },
      { tab: 4, capacity: 24, items: [] },
    ],
  },
});
await new Promise((resolve) => setTimeout(resolve, 10));
socket.push({
  t: "shop-open",
  shop: {
    shopId: 2003,
    items: [
      { itemId: 2000000, price: 25, maxCount: 200 },
      { itemId: 2030000, price: 75, maxCount: 5 },
    ],
  },
});
await new Promise((resolve) => setTimeout(resolve, 10));
// The sheet is drawn on the canvas at its centred spot (196, 154): row 1 of the left list is
// (6..200, 68..100), the 사기 button (78,31)-(124,50), the tab strip (206..404, 65..89) and the
// CLOSE stamp (188,9)-(220,24). The test clicks those exact window-local points.
const shopPoint = (x: number, y: number): PointerPoint => ({ clientX: 196 + x, clientY: 154 + y });
canvasEl.fire("click", shopPoint(40, 80)); // pick the first row
clickControl(shopPoint(100, 40)); // 사기 opens quantity
assert.equal(probe.itemDialog.open, true);
el("item-dialog-ok").fire("click");
let lastShop = sent.at(-1);
console.log("buy 1:", JSON.stringify(lastShop));
if (
  lastShop?.t !== "shop" ||
  lastShop.action !== "buy" ||
  lastShop.row !== 0 ||
  lastShop.count !== 1
)
  throw new Error(`bad buy: ${JSON.stringify(lastShop)}`);
socket.push({ t: "shop-result", code: 0, message: "silent" });
canvasEl.fire("dblclick", shopPoint(40, 115)); // second row opens quantity
el("item-dialog-ok").fire("click");
lastShop = sent.at(-1);
console.log("double click buy:", JSON.stringify(lastShop));
if (lastShop?.t !== "shop" || lastShop.action !== "buy" || lastShop.row !== 1)
  throw new Error(`bad double click buy: ${JSON.stringify(lastShop)}`);
socket.push({ t: "shop-result", code: 0, message: "silent" });
// The right pane starts on 장비; switch it to 소비 (second tab) to reach the potion in `inventory`.
canvasEl.fire("click", shopPoint(279, 77));
canvasEl.fire("click", shopPoint(280, 100)); // first row of the sell pane
clickControl(shopPoint(306, 40)); // 팔기 opens total/1/total
el("item-dialog-ok").fire("click");
lastShop = sent.at(-1);
console.log("sell:", JSON.stringify(lastShop));
if (lastShop?.t !== "shop" || lastShop.action !== "sell" || lastShop.itemId !== 2000000)
  throw new Error(`bad sell: ${JSON.stringify(lastShop)}`);
socket.push({ t: "shop-result", code: 2, message: "shop result 2 (notEnoughMesos)" });
await new Promise((resolve) => setTimeout(resolve, 10));
clickControl(shopPoint(204, 16)); // CLOSE stamp
lastShop = sent.at(-1);
console.log("shop close:", JSON.stringify(lastShop));
if (lastShop?.t !== "shop" || lastShop.action !== "close")
  throw new Error("CLOSE must send shop close");

socket.push({ t: "npc-say", npcId: 7, message: "안녕하세요" });
await new Promise((resolve) => setTimeout(resolve, 10));
console.log(
  "dialogue:",
  JSON.stringify(el("dialogue-text").textContent),
  "hidden:",
  el("dialogue").classList.contains("hidden"),
);
// npcdialogue.ts builds the answer buttons into #dialogue-controls (no static ids) and clears
// them per dialogue; for a plain say the spec list is [close=255, primary OK=1] (the native
// 0xFF close vs the answer-1 OK, npcdialogue-layout.ts dialogueButtons). A programmatic click
// carries detail 0 - the browser's own element.click() semantics the released-gate accepts.
const primaryButton = el("dialogue-controls").children.find(
  (button) => button.dataset.dialogueKey === "primary",
);
if (!primaryButton) throw new Error("the dialogue built no primary answer button");
primaryButton.fire("click");
console.log("talk ok:", JSON.stringify(sent.at(-1)));
if (sent.at(-1)?.t !== "talk" || sent.at(-1)?.answer !== 1)
  throw new Error("確定 must send answer 1");
if (!el("dialogue").classList.contains("hidden"))
  throw new Error("the dialogue should close on 確定");

// ------------------------------------------------------------------ inventory window
// `I` opens the sheet (there is no packet); it is drawn on the canvas, so the test drives it through
// the same pointer events a player would. The shim never finishes loading art, so only the hit
// testing and the `use` packet are observable here.
el("log").classList.add("hidden");
emitWindow("keydown", { key: "i", preventDefault() {} });
socket.push({
  t: "inventory",
  inventory: {
    worn: [],
    wornCash: [],
    tabs: [
      { tab: 1, capacity: 24, items: [] },
      {
        tab: 2,
        capacity: 24,
        items: [
          { slot: 1, itemId: 2000000, quantity: 3 },
          { slot: 4, itemId: 2030004, quantity: 1 },
        ],
      },
      { tab: 3, capacity: 24, items: [] },
      { tab: 4, capacity: 24, items: [] },
    ],
  },
});
await new Promise((resolve) => setTimeout(resolve, 10));
const surface = (x: number, y: number): PointerPoint => ({ clientX: x, clientY: y });
// CConfig type0 opens at (24,24); close114,9 is local, not the window origin.
canvasEl.fire("click", surface(24 + 53, 24 + 64)); // Native default is EQUIP; explicitly select USE.
canvasEl.fire("click", surface(46, 120));
canvasEl.fire("dblclick", surface(46, 120));
const use = sent.at(-1);
console.log("use sent:", JSON.stringify(use));
if (use?.t !== "use" || use.slot !== 1 || use.itemId !== 2000000)
  throw new Error(`bad use: ${JSON.stringify(use)}`);
// Slot 4 holds the map-item sender (2030004), also usable from the USE tab. useBagItem keeps the
// native 200ms consecutive-use gate (nextBagUseAt), so the battery waits it out and then asserts
// the second use really is slot 4 - the old bare log silently showed the stale slot-1 packet.
await new Promise((resolve) => setTimeout(resolve, 210));
canvasEl.fire("dblclick", surface(24 + 6 + 3 * 35 + 16, 120));
const mapItemUse = sent.at(-1);
console.log("map item sent:", JSON.stringify(mapItemUse));
if (mapItemUse?.t !== "use" || mapItemUse.slot !== 4 || mapItemUse.itemId !== 2030004)
  throw new Error(`bad map item use: ${JSON.stringify(mapItemUse)}`);
// Tab 2 (소비) is the second box: x 36..70, y 52..76.
canvasEl.fire("click", surface(24 + 53, 24 + 64));
// The CLOSE pentagon at the top right closes it again.
clickControl(surface(24 + 130, 24 + 14));
console.log("closed:", elements.has("inventory") ? "unexpected" : "no DOM panel");
// The window was closed by the CLOSE click above; open it again so the frames draw it.
emitWindow("keydown", { key: "i", preventDefault() {} });
for (let frame = 0; frame < 3; frame++) {
  const callback = frameCallback;
  frameCallback = undefined;
  callback?.(Date.now());
  // Let the art's `onload` land, so the next frame can draw the sheet and its icons.
  await new Promise((resolve) => setTimeout(resolve, 5));
}
console.log("rendered", 3, "frames; drawImage calls:", drawImageCalls);
if (drawImageCalls < 9) throw new Error(`the renderer drew too little: ${drawImageCalls}`);
console.log("handled", messages.length, "messages; sent", sent.length, "->", JSON.stringify(sent));
console.log("SMOKE OK");

// ------------------------------------------------------------------ stat / AP
// Native Stat/AP controls: original sheet, no optimistic stat mutation, pending + 500ms gate.
const statSelf = {
  ...fixtureSelf(messages.findLast((message) => message.t === "self")),
  str: 12,
  dex: 5,
  int: 4,
  luk: 4,
  ap: 3,
  sp: 0,
  fame: 0,
  expToNext: 100,
};
socket.push({ t: "self", self: statSelf });
emitWindow("keydown", { key: "s", preventDefault() {} });
await render();
assert.equal(el("stat-window").classList.contains("hidden"), false);
// sub_4F3210 enables the SIX AP buttons (ids 2000..2005: STR/DEX/INT/LUK/HP/MP) by AP!=0; the
// pending/500ms gates live in the sender (sub_55CF60), never in the button art (FINDINGS §4.42).
// stat-detail stays disabled until the native basis (character-stats) arrives.
assert.equal(el("ap-maxHp").disabled, false);
assert.equal(el("ap-maxMp").disabled, false);
assert.equal(el("stat-detail").disabled, true);
assert.equal(el("ap-str").disabled, false);
emitWindow("keydown", { key: "s", repeat: true, preventDefault() {} });
assert.equal(
  el("stat-window").classList.contains("hidden"),
  false,
  "key repeat must not flap the window",
);
const apBefore = sent.filter((packet) => packet.t === "ability-up").length;
el("ap-str").fire("click");
el("ap-dex").fire("click");
assert.deepEqual(sent.at(-1), { t: "ability-up", field: "str" });
assert.equal(sent.filter((packet) => packet.t === "ability-up").length, apBefore + 1);
await render();
assert.match(el("stat-values").textContent, /STR 12.*AP 3/, "wait for server, not fake +1 locally");
socket.push({ t: "self", self: { ...statSelf, str: 13, ap: 2 } });
socket.push({ t: "ability-result", changed: true });
await render();
assert.match(el("stat-values").textContent, /STR 13.*AP 2/);
assert.equal(
  el("ap-dex").disabled,
  false,
  "native Update keeps AP buttons visibly enabled during the send cooldown",
);
el("ap-dex").fire("click");
assert.equal(
  sent.filter((packet) => packet.t === "ability-up").length,
  apBefore + 1,
  "500ms send gate survives a fast acknowledgment",
);
await new Promise((resolve) => setTimeout(resolve, 510));
await render();
assert.equal(el("ap-dex").disabled, false);
el("ap-dex").fire("click");
socket.push({ t: "ability-result", changed: false });
await new Promise((resolve) => setTimeout(resolve, 510));
await render();
assert.equal(el("ap-dex").disabled, false, "refusal releases pending");
el("stat-body").fire("mousedown", surface(100, 90));
emitWindow("mousemove", surface(1000, 1000));
emitWindow("mouseup", {});
assert.deepEqual(JSON.parse(storage.get("kms111.statAt") ?? "null"), { x: 624, y: 285 });
// The frame section above left the inventory open, and main.js's Escape walks the native cascade
// (drag -> inventory -> equip -> stat -> skill -> shop -> dialogue -> system), one window a press.
assert.equal(probe.inventoryOpen, true, "the frame battery leaves the bag open");
emitWindow("keydown", { key: "Escape", preventDefault() {} });
assert.equal(probe.inventoryOpen, false, "the first Escape closes the bag, not the stat sheet");
assert.equal(el("stat-window").classList.contains("hidden"), false);
emitWindow("keydown", { key: "Escape", preventDefault() {} });
assert.equal(el("stat-window").classList.contains("hidden"), true);
console.log("STAT/AP REGRESSIONS OK");

// ------------------------------------------------------------------ shop regressions
const stock = Array.from({ length: 12 }, (_, index) => ({
  itemId: 2000000 + index,
  price: 25,
  maxCount: 200,
}));
const items = Array.from({ length: 8 }, (_, index) => ({
  slot: index + 1,
  itemId: 2000000 + index,
  quantity: 3,
}));
const inventoryMessage = (
  rows: { slot: number; itemId: number; quantity: number }[],
): WireMessage => ({
  t: "inventory",
  inventory: {
    worn: [],
    wornCash: [],
    tabs: [
      { tab: 1, capacity: 24, items: [] },
      { tab: 2, capacity: 24, items: rows },
      { tab: 3, capacity: 24, items: [] },
      { tab: 4, capacity: 24, items: [] },
    ],
  },
});
socket.push(inventoryMessage(items));
socket.push({ t: "shop-open", shop: { shopId: 2003, items: stock } });
canvasEl.fire("click", shopPoint(279, 77));
assert.equal(probe.shopRowsOf("sell").length, 8);
// Clicking the very first pixel of a scrollbar must not select a row or start a window drag.
assert.equal(probe.shopWindowAt(196 + 189, 154 + 80).kind, "scrollbar");
canvasEl.fire("click", shopPoint(195, 269)); // next arrow
assert.equal(probe.scroll.buy, 1);
canvasEl.fire("click", shopPoint(195, 74)); // prev arrow
assert.equal(probe.scroll.buy, 0);
canvasEl.fire("click", shopPoint(195, 200)); // page down
assert.equal(probe.scroll.buy, 6);
canvasEl.fire("wheel", { ...shopPoint(195, 180), deltaY: -1 });
assert.equal(probe.scroll.buy, 5); // wheel over the scrollbar itself
canvasEl.fire("wheel", { ...shopPoint(195, 180), deltaY: 0 });
assert.equal(probe.scroll.buy, 5);
canvasEl.fire("click", shopPoint(195, 74));
const thumbY = 68 + 12 + probe.shopScrollbarGeometry("buy").offset + 6;
canvasEl.fire("mousedown", shopPoint(195, thumbY));
canvasMouseMove(shopPoint(195, 268));
windowMouseUp(shopPoint(195, 268));
canvasEl.fire("click", shopPoint(195, 268)); // native click following a drag is suppressed
assert.equal(probe.scroll.buy, 6);
canvasEl.fire("click", shopPoint(40, 80));
clickControl(shopPoint(100, 40));
el("item-dialog-ok").fire("click");
socket.push({ t: "shop-result", code: 0, message: "silent" });
assert.equal(sent.at(-1)?.row, 6); // visible row zero refers to stock row six
// Inventory shrinking under the scroll thumb clamps the offset; removed selections cannot sell.
canvasEl.fire("wheel", { ...shopPoint(280, 230), deltaY: 1 });
assert.equal(probe.scroll.sell, 1);
canvasEl.fire("click", shopPoint(280, 100));
assert.equal(probe.picked?.itemId, items[1]?.itemId);
socket.push(inventoryMessage([items[0] ?? { slot: 1, itemId: 0, quantity: 0 }]));
assert.equal(probe.scroll.sell, 0);
assert.equal(probe.picked, undefined);
const before = sent.length;
clickControl(shopPoint(306, 40));
assert.equal(sent.length, before);
// A drag released outside the canvas must finish, persist and never leave the button depressed.
canvasEl.fire("mousedown", shopPoint(20, 20));
canvasMouseMove(shopPoint(30, 30));
windowMouseUp(shopPoint(30, 30));
assert.equal(probe.dragging, false);
assert.deepEqual(JSON.parse(storage.get("kms111.shopAt") ?? "null"), { x: 206, y: 164 });
// ADR-064 SOURCE ONLY: native tooltip parsing is separate from dialogue/legacy compact wrapping.
assert.deepEqual(
  nativeTooltipRows("First\\nSecond", (text) => text.length * 6, 178),
  ["First", "Second"],
);
const nativePlan = nativeItemTooltip(
  { name: "Potion", desc: "First\\nSecond" },
  { width: (text) => text.length * 6, height: () => 13 },
);
if (!nativePlan) throw new Error("nativeItemTooltip refused the plain item tooltip");
assert.deepEqual(
  nativePlan.commands.flatMap((command) => ("text" in command ? [command.text] : [])),
  ["Potion", "First", "Second"],
);
console.log("SHOP REGRESSIONS OK");

// ------------------------------------------------------------------ failed login and retry
// Isolated at the end so switching the test's stage does not affect the field/Shop assertions above.
el("title-continue").fire("click");
el("user").value = "admin";
el("pass").value = "wrong";
el("login").fire("click");
await new Promise((resolve) => setTimeout(resolve, 5));
const retrySocket = sockets.at(-1);
if (!retrySocket) throw new Error("the retry opened no socket");
retrySocket.push({ t: "login", result: 4, worlds: [] });
assert.equal(el("login").disabled, false);
assert.match(el("status").textContent, /登入失敗/);
assert.equal(probe.dialog, true);
el("pass").value = "admin";
el("login").fire("click");
await new Promise((resolve) => setTimeout(resolve, 5));
const activeSocket = sockets.at(-1);
if (!activeSocket) throw new Error("the retry opened no socket");
// Late events from the old socket must not overwrite the retry's state.
socket.emit("close");
assert.equal(el("login").disabled, true);
activeSocket.push({ t: "login", result: 0, worlds: [] });
assert.equal(probe.stage, "worlds");
assert.equal(el("pass").value, "");
assert.equal(el("login").disabled, false);
console.log("TITLE REGRESSIONS OK");

// ------------------------------------------------------------------ selection regressions
// Original selection windows are canvas art, not immediate-enter HTML cards.
activeSocket.push({
  t: "login",
  result: 0,
  worlds: [
    { name: "Scania", unknownId: 20 },
    { name: "Offline", unknownId: 0xffffffff },
  ],
});
assert.equal(el("world-connect").disabled, true);
await render();
assert.ok(stamp("UI/Login.img/WorldSelect/menu", 250, 89));
assert.ok(stamp("UI/Login.img/WorldSelect/wsHeader", 274, 270));
let sentAt = sent.length;
el("world-list").children[0].fire("click");
assert.equal(sent.length, sentAt, "row selection does not connect");
assert.equal(el("world-connect").disabled, false);
el("world-list").children[1].fire("click");
assert.equal(el("world-connect").disabled, true, "offline worlds cannot connect");
el("world-list").children[0].fire("click");
el("world-connect").fire("click");
assert.deepEqual(sent.at(-1), { t: "world", index: 0 });
el("world-connect").fire("click");
assert.equal(sent.length, sentAt + 1, "pending double-submit is ignored");
// readLoginCharacters (login-data.ts) validates the FULL CharacterSummary the server sends
// (webclient.ts summaryOf): str/dex/int/luk/face/hair are required, and a malformed entry blocks
// the whole list, so the fixture carries the real wire shape.
const roster: Record<string, unknown>[] = [
  characterSummary(21, "Hero", 2, 20000, 30000, 50, 30),
  characterSummary(22, "Alt", 1, 21000, 31000, 40, 20),
];
activeSocket.push({ t: "characters", result: 0, characters: roster });
await render();
assert.ok(stamp("UI/Login.img/CharSelect/menu", 161, 85));
assert.ok(stamp("UI/Login.img/CharSelect/BtSelect/normal/0", 466, 375));
assert.equal(el("character-list").children[0]?.style.left, "231px");
assert.equal(el("character-list").children[1]?.style.left, "371px");
sentAt = sent.length;
el("character-list").children[1].fire("click");
assert.equal(sent.length, sentAt, "selecting a character must not enter the field");
el("character-enter").fire("click");
assert.deepEqual(sent.at(-1), { t: "character", id: 22 });
el("character-enter").fire("click");
assert.equal(sent.length, sentAt + 1);
assert.equal(
  el("character-delete").disabled,
  true,
  "all mutations are disabled during field entry",
);
console.log("SELECTION REGRESSIONS OK");

// ------------------------------------------------------------------ creation / deletion
const tick = (ms = 0): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
// Real page/controller, native canvas and hit targets; no socket/network stub may create implicitly.
activeSocket.push({ t: "characters", result: 0, characters: roster });
el("character-new").fire("click");
await tick();
await tick();
assert.equal(el("character-dialogs").classList.contains("hidden"), false);
assert.equal(
  el("new-character").classList.contains("hidden"),
  true,
  "native naming notice precedes the dialog",
);
el("native-ok").fire("click");
await render();
assert.equal(el("new-character").classList.contains("hidden"), false);
assert.ok(stamp("UI/Login.img/CharSelect/newDlg", 270, 88));
assert.equal(el("new-name").style.left, "110px");
assert.equal(el("create").style.top, "383px");
el("new-name").value = "NativeHero";
el("new-name").fire("input");
sentAt = sent.length;
el("create").fire("click");
assert.equal(sent.length, sentAt, "unverified names never create");
el("native-ok").fire("click");
el("check-name").fire("click");
el("check-name").fire("click");
assert.equal(sent.length, sentAt + 1, "name checks cannot double-submit");
assert.equal(sent.at(-1)?.t, "check-name");
assert.equal((sent.at(-1)?.appearance as unknown[])?.length, 10);
activeSocket.push({ t: "name-checked", name: "NativeHero", result: 0 });
el("native-ok").fire("click");
el("new-name").value = "ChangedHero";
el("new-name").fire("input");
sentAt = sent.length;
el("create").fire("click");
assert.equal(sent.length, sentAt, "editing invalidates checked name");
el("native-ok").fire("click");
el("check-name").fire("click");
activeSocket.push({ t: "name-checked", name: "ChangedHero", result: 0 });
el("native-ok").fire("click");
el("create-combo-0").fire("click");
el("creation-options").children[2].fire("click");
el("roll-dice").fire("click");
await tick(400);
await render();
el("create").fire("click");
el("create").fire("click");
assert.equal(sent.at(-1)?.t, "create");
assert.equal(sent.at(-1)?.name, "ChangedHero");
assert.equal((sent.at(-1)?.appearance as number[])?.[0], 20002);
assert.equal(
  (sent.at(-1)?.appearance as number[]).slice(6).reduce((a, b) => a + b, 0),
  25,
);
activeSocket.push({
  t: "characters",
  result: 0,
  characters: [...roster, characterSummary(23, "ChangedHero", 1, 20002, 30000, 40, 20)],
});
activeSocket.push({ t: "created", ok: true, name: "ChangedHero", id: 23 });
assert.equal(el("character-dialogs").classList.contains("hidden"), true);
assert.equal(el("character-new").disabled, true, "three slots are full");
el("character-delete").fire("click");
sentAt = sent.length;
el("native-no").fire("click");
assert.equal(sent.length, sentAt, "No sends no delete");
el("character-delete").fire("click");
await render();
assert.ok(stamp("UI/Basic.img/YesNo/backgrnd", 268, 234));
el("native-yes").fire("click");
el("native-yes").fire("click");
assert.equal(sent.length, sentAt + 1);
assert.deepEqual(sent.at(-1), { t: "delete-character", id: 23, confirmed: true });
activeSocket.push({ t: "characters", result: 0, characters: roster });
activeSocket.push({ t: "deleted", id: 23, ok: true });
assert.equal(el("character-dialogs").classList.contains("hidden"), true);
assert.equal(el("character-new").disabled, false);
console.log("NATIVE CREATION/DELETION REGRESSIONS OK");

// ------------------------------------------------------------------ chat commands
let stopped = false;
el("say").value = "/where";
el("say").fire("keydown", {
  key: "Enter",
  stopPropagation() {
    stopped = true;
  },
});
assert.equal(
  stopped,
  true,
  "chat Enter must not reopen itself in the bubbling game shortcut handler",
);
const cmdLines: string[] = [];
const local = (_name: string, text: string): number => cmdLines.push(text);
const oldSent = sent.length;
assert.equal(probe.runCommand("/map 1.5", local), true);
assert.equal(sent.length, oldSent);
probe.runCommand("/map 1000000", local);
assert.deepEqual(sent.at(-1), { t: "warp-map", mapId: 1000000 });
probe.runCommand("/map 0", local);
assert.deepEqual(sent.at(-1), { t: "warp-map", mapId: 0 });
probe.runCommand("/help", local);
assert.match(cmdLines.at(-1) ?? "", /maps/);
console.log("PORTAL COMMAND / CHAT FOCUS REGRESSIONS OK");

// ------------------------------------------------------------------ equipment admission
// Browser inventory gestures are authoritative: no optimistic writes, ack != 0, 500ms.
const equipSelf = { ...statSelf, characterId: 21, mapId: 1000000, hp: 50, gender: 0, level: 12 };
activeSocket.push({ t: "field", mapId: 1000000, self: equipSelf, users: [], mobs: [], npcs: [] });
const gear: ProbeGear = { slot: 1, itemId: 1002008, ruc: 4, cuc: 2, stats: { str: 3 } };
interface ProbeTab {
  tab: number;
  capacity: number;
  items: ProbeGear[];
}
interface ProbeInventory {
  worn: unknown[];
  wornCash: unknown[];
  tabs: ProbeTab[];
}
const gearInventory: ProbeInventory = {
  worn: [],
  wornCash: [],
  tabs: [
    { tab: 1, capacity: 24, items: [gear] },
    ...[2, 3, 4].map((tab) => ({ tab, capacity: 24, items: [] as ProbeGear[] })),
  ],
};
activeSocket.push({ t: "inventory", inventory: gearInventory });
probe.setFacts(gear.itemId, {
  requirements: { level: 30, job: 0, str: 0, dex: 0, int: 0, luk: 0 },
});
let gearCount = sent.filter((packet) => packet.t === "change-slot").length;
await probe.wearItem(gear, 1);
assert.equal(
  sent.filter((packet) => packet.t === "change-slot").length,
  gearCount,
  "refusal is a local notice, not a JS error or packet",
);
probe.setFacts(gear.itemId, {
  requirements: { level: 1, job: 0, str: 0, dex: 0, int: 0, luk: 0 },
});
await probe.wearItem(gear, 1);
assert.deepEqual(sent.at(-1), { t: "change-slot", tab: 1, fromSlot: 1, toSlot: -1, count: -1 });
assert.equal(probe.inventory.worn.length, 0, "do not invent successful equipment before 0x0B");
activeSocket.push({ t: "inventory", inventory: gearInventory, ack: false });
await new Promise((resolve) => setTimeout(resolve, 510));
await probe.wearItem(gear, 1);
assert.equal(
  sent.filter((packet) => packet.t === "change-slot").length,
  gearCount + 1,
  "non-ack inventory update must not release pending",
);
activeSocket.push({ t: "inventory", inventory: gearInventory, ack: true });
await probe.wearItem(gear, 1);
assert.equal(sent.filter((packet) => packet.t === "change-slot").length, gearCount + 2);
activeSocket.push({
  t: "user-enter",
  user: {
    characterId: 22,
    name: "Alt",
    face: 20000,
    avatarItems: [30000],
    x: 100,
    y: 300,
    action: 4,
    foothold: 32,
  },
});
const remote = probe.remoteUsers.get("22");
if (!remote) throw new Error("remote user 22 never entered the field");
remote.probePath = { kept: true };
activeSocket.push({ t: "user-look", characterId: 22, avatarItems: [30000, 1002008] });
assert.equal(probe.remoteUsers.get("22"), remote);
assert.deepEqual(remote.probePath, { kept: true });
assert.equal(remote.face, 20000);
assert.deepEqual(remote.avatarItems, [30000, 1002008]);
console.log("EQUIPMENT REQUIREMENTS / ACK / AUTHORITATIVE LOOK / REMOTE PATH REGRESSIONS OK");

// ------------------------------------------------------------------ skill sources
// New skill UI regression source only: not executed for this delivery.
assert.equal(skillRowAt(5, 119, 8), 0);
assert.equal(skillRowAt(158, 156, 8), 0);
assert.equal(skillRowAt(5, 157, 8), -1, "38px native row, not the two-pixel gap");
assert.equal(skillRowAt(5, 158, 8), -1);
assert.equal(skillRowAt(5, 159, 8, 2), 3);
assert.equal(skillRowAt(5, 277, 8), -1);
assert.equal(skillRowAt(159, 122, 8), -1);
const skillFixture = { id: 1000001, maxLevel: 10, requirements: [{ skillId: 1000000, level: 5 }] };
assert.equal(skillState(skillFixture, new Map()), 0);
assert.equal(skillState(skillFixture, new Map([[1000000, 5]])), 1);
assert.equal(
  skillState(
    skillFixture,
    new Map([
      [1000000, 5],
      [1000001, 10],
    ]),
  ),
  -1,
);
probe.skillPanel.toggle(true);
await render();
assert.equal(el("skill-window").classList.contains("hidden"), false);
assert.ok(stamp("UI/UIWindow.img/Skill/backgrnd", 96, 96));
assert.equal(el("sp-up-0").hidden, true, "native beginners have no skill book");
el("skill-close").fire("click");
assert.equal(probe.skillPanel.open, false);
console.log("SKILL BOOK / NATIVE ROW / EMPTY BEGINNER REGRESSION SOURCES OK");

// ------------------------------------------------------------------ recovery sources
// Recovery model regression sources; do not treat this addition as an executed probe.
const recoverInput: RecoveryInput = {
  hp: 20,
  maxHp: 50,
  mp: 0,
  maxMp: 50,
  action: 2,
  stationary: true,
};
const recoverClock = { hp: 0, mp: 0 };
for (let i = 0; i < 333; i++) assert.deepEqual(recoveryTick(recoverClock, recoverInput), []);
assert.deepEqual(recoveryTick(recoverClock, recoverInput), [
  { hpDelta: 10, flag: 0 },
  { mpDelta: 3, flag: 0 },
]);
assert.deepEqual(
  recoveryTick({ hp: 9990, mp: 9990 }, { ...recoverInput, action: 0, stationary: false }),
  [{ mpDelta: 3, flag: 0 }],
);
assert.deepEqual(
  recoveryTick({ hp: 30990, mp: 0 }, { ...recoverInput, action: 36, climbMs: 31000, hpBonus: 3 }),
  [{ hpDelta: 13, flag: 1 }],
);
assert.deepEqual(recoveryTick({ hp: 9990, mp: 9990 }, { ...recoverInput, action: 37 }), [
  { mpDelta: 3, flag: 0 },
]);
assert.deepEqual(recoveryTick({ hp: 9990, mp: 9990 }, { ...recoverInput, hp: 0 }), []);
assert.deepEqual(
  recoveryTick(
    { hp: 9990, mp: 9990 },
    { ...recoverInput, hp: 49, mp: 49, rate: 1.5, hpBonus: 50, mpBonus: 32 },
  ),
  [
    { hpDelta: 1, flag: 0 },
    { mpDelta: 1, flag: 0 },
  ],
);
assert.deepEqual(recoveryTick({ hp: 9990, mp: 9990 }, { ...recoverInput, rate: 0 }), []);
assert.deepEqual(
  recoveryBonuses(
    100,
    new Map([
      [1000000, 99],
      [1000002, 1],
    ]),
    new Map([
      [1000000, { maxLevel: 16, levels: [{ level: 16, hs: "", values: { hp: 50 } }] }],
      [1000002, { maxLevel: 8, levels: [{ level: 1, hs: "", values: { time: 31 } }] }],
    ]),
  ),
  { hpBonus: 50, mpBonus: 0, climbMs: 31000 },
);
// The operator panel must not mutate on open or on merely filling a preset.
const beforeTools = sent.length;
probe.testToolsPanel.openPanel();
assert.deepEqual(sent.at(-1), { t: "test-tools", action: { kind: "state" } });
activeSocket.push({
  t: "test-tools",
  enabled: true,
  canMap: true,
  checkpoint: false,
  restoreAvailable: false,
  message: "source fixture",
  jobs: [
    { id: 0, name: "초보자" },
    { id: 100, name: "검사" },
  ],
});
el("qa-warrior").fire("click");
assert.equal(sent.length, beforeTools + 1);
assert.equal(el("qa-apply").disabled, true, "no mutation before explicit confirmation");
el("qa-confirm").checked = true;
el("qa-confirm").fire("change");
assert.equal(el("qa-apply").disabled, false);
probe.testToolsPanel.close();
console.log("RECOVERY / EXPLICIT TEST TOOL REGRESSION SOURCES OK");

// The startup guard arms a real 15s timeout timer; every regression above has already run
// synchronously, so exit explicitly instead of idling until that timer fires.
process.exit(0);

// ------------------------------------------------------------------ fixture helpers
/** The wire's full CharacterSummary (webclient.ts summaryOf); login-data.ts validates every field. */
function characterSummary(
  id: number,
  name: string,
  level: number,
  face: number,
  hair: number,
  hp: number,
  mp: number,
): Record<string, unknown> {
  return {
    id,
    name,
    level,
    job: 0,
    face,
    hair,
    hp,
    maxHp: hp,
    mp,
    maxMp: mp,
    exp: 0,
    mesos: 0,
    mapId: 0,
    str: 4,
    dex: 4,
    int: 4,
    luk: 4,
    items: [],
  };
}
/** A pushed message's `self` block, checked instead of cast. */
function fixtureSelf(message: WireMessage | undefined): Record<string, unknown> {
  const self = message?.self;
  if (typeof self !== "object" || self === null)
    throw new Error("client_probe: the fixture message has no self block");
  return self as Record<string, unknown>;
}
