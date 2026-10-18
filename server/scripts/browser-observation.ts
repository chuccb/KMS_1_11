/** Manual fixture observations, not a game transport or an alternate renderer.
 * installBrowserObservation is serialized by Playwright: keep every runtime dependency inside it.
 * Parsed packets expose only validated fields used by these probes; unknown kinds remain visible.
 */
export interface ProbeSelf {
  str: number;
  dex: number;
  int: number;
  luk: number;
  ap: number;
  spawnPortal: number;
  avatarItems: number[];
}
export interface ProbeItem {
  slot: number;
  itemId: number;
  quantity?: number;
  cuc?: number;
  ruc?: number;
  stats?: { str: number };
}
export interface ProbeInventory {
  worn: ProbeItem[];
  tabs: { tab: number; items: ProbeItem[] }[];
}
export interface ProbePath {
  originX: number;
  originY: number;
  elements: { x?: number; y?: number; duration: number }[];
}
export type ProbePacket = (
  | { t: "move"; x: number; y: number; vx: number; vy: number; foothold: number; action: number }
  | { t: "field"; mapId: number; self: ProbeSelf }
  | { t: "self"; self: ProbeSelf }
  | { t: "characters"; characters: { id: number; name: string; str: number; luk: number }[] }
  | { t: "inventory"; inventory: ProbeInventory }
  | { t: "mob-move"; path?: ProbePath }
  | { t: "user-look"; avatarItems?: number[] }
  | { t: "create"; appearance: number[] }
  | { t: "created"; ok: boolean; id?: number }
  | { t: "deleted"; ok: boolean; id?: number }
  | { t: "delete-character"; id: number }
  | { t: "name-checked"; result: number }
  | { t: "change-slot"; count: number }
  | { t: "portal"; name: string }
  | { t: "chat"; text: string }
  | { t: "ability-result"; changed: boolean }
  | { t: "login" | "world" | "character" | "ability-up" | "error" }
  | { t: "other"; kind: string; payload: Record<string, unknown> }
) & { at: number };
export interface ProbeDraw {
  src: string;
  args: number[];
  canvas: [number, number];
  matrix: { a: number; e: number; f: number };
}
export interface ProbeGameSnapshot {
  camera: { x: number; y: number };
  mobs: {
    mobId: number;
    templateId: number;
    x: number;
    y: number;
    facing: number;
    walking?: boolean;
  }[];
  arts: [number, Record<string, { path: string; ox: number; oy: number }[]>][];
}
export interface BrowserObservation {
  game(): ProbeGameSnapshot;
  sent: ProbePacket[];
  messages: ProbePacket[];
  invalid: string[];
  draws: ProbeDraw[];
  texts: { text: string; x: number; y: number }[];
  miniBlits: ProbeDraw[];
  miniMarks: number[][];
  blobSources: Record<string, string>;
  activeBlobs: Set<string>;
  audio: {
    loop: boolean;
    duration?: number;
    rate?: number;
    energy: boolean;
    state: AudioContextState;
  }[];
}
declare global {
  interface Window {
    /** Exists only in explicitly instrumented probe pages, never installed by the game. */
    __kmsProbe: BrowserObservation;
    __kmsGameObservation?: () => unknown;
  }
}

export function installBrowserObservation() {
  if (window.__kmsProbe) throw new Error("Probe observations already installed");
  const state: BrowserObservation = (window.__kmsProbe = {
    game,
    sent: [],
    messages: [],
    invalid: [],
    draws: [],
    texts: [],
    miniBlits: [],
    miniMarks: [],
    blobSources: {},
    activeBlobs: new Set(),
    audio: [],
  });
  // Diagnostic history policy, not native timing. Each collection is independently bounded.
  function append<T>(list: T[], value: T, limit = 5000) {
    list.push(value);
    if (list.length > limit) list.splice(0, list.length - limit);
  }
  function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function number(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
  }
  function numbers(value: unknown): value is number[] {
    return Array.isArray(value) && value.every(number);
  }
  function self(value: unknown): ProbeSelf {
    if (
      !record(value) ||
      !number(value.str) ||
      !number(value.dex) ||
      !number(value.int) ||
      !number(value.luk) ||
      !number(value.ap) ||
      !number(value.spawnPortal) ||
      !numbers(value.avatarItems)
    )
      throw new Error("Invalid self observation");
    return {
      str: value.str,
      dex: value.dex,
      int: value.int,
      luk: value.luk,
      ap: value.ap,
      spawnPortal: value.spawnPortal,
      avatarItems: value.avatarItems,
    };
  }
  function item(value: unknown): ProbeItem {
    if (
      !record(value) ||
      !number(value.slot) ||
      !number(value.itemId) ||
      [value.quantity, value.cuc, value.ruc].some((v) => v !== undefined && !number(v))
    )
      throw new Error("Invalid inventory item observation");
    const out: ProbeItem = { slot: value.slot, itemId: value.itemId };
    if (number(value.quantity)) out.quantity = value.quantity;
    if (number(value.cuc)) out.cuc = value.cuc;
    if (number(value.ruc)) out.ruc = value.ruc;
    if (value.stats !== undefined) {
      if (!record(value.stats) || !number(value.stats.str))
        throw new Error("Invalid item stats observation");
      out.stats = { str: value.stats.str };
    }
    return out;
  }
  function inventory(value: unknown): ProbeInventory {
    if (!record(value) || !Array.isArray(value.worn) || !Array.isArray(value.tabs))
      throw new Error("Invalid inventory observation");
    return {
      worn: value.worn.map(item),
      tabs: value.tabs.map((tab: unknown) => {
        if (!record(tab) || !number(tab.tab) || !Array.isArray(tab.items))
          throw new Error("Invalid inventory tab observation");
        return { tab: tab.tab, items: tab.items.map(item) };
      }),
    };
  }
  function path(value: unknown): ProbePath | undefined {
    if (value === undefined) return;
    if (
      !record(value) ||
      !number(value.originX) ||
      !number(value.originY) ||
      !Array.isArray(value.elements)
    )
      throw new Error("Invalid path observation");
    return {
      originX: value.originX,
      originY: value.originY,
      elements: value.elements.map((e: unknown) => {
        if (
          !record(e) ||
          !number(e.duration) ||
          (e.x !== undefined && !number(e.x)) ||
          (e.y !== undefined && !number(e.y))
        )
          throw new Error("Invalid path element observation");
        return {
          duration: e.duration,
          ...(number(e.x) ? { x: e.x } : {}),
          ...(number(e.y) ? { y: e.y } : {}),
        };
      }),
    };
  }
  function game(): ProbeGameSnapshot {
    const value = window.__kmsGameObservation?.();
    if (
      !record(value) ||
      !record(value.camera) ||
      !number(value.camera.x) ||
      !number(value.camera.y) ||
      !Array.isArray(value.mobs) ||
      !Array.isArray(value.arts)
    )
      throw new Error("Missing or invalid readonly game observation");
    const mobs = value.mobs.map((mob: unknown) => {
      if (
        !record(mob) ||
        !number(mob.mobId) ||
        !number(mob.templateId) ||
        !number(mob.x) ||
        !number(mob.y) ||
        !number(mob.facing) ||
        (mob.walking !== undefined && typeof mob.walking !== "boolean")
      )
        throw new Error("Invalid mob observation");
      return {
        mobId: mob.mobId,
        templateId: mob.templateId,
        x: mob.x,
        y: mob.y,
        facing: mob.facing,
        ...(typeof mob.walking === "boolean" ? { walking: mob.walking } : {}),
      };
    });
    const arts = value.arts.map((entry: unknown): ProbeGameSnapshot["arts"][number] => {
      if (!Array.isArray(entry) || entry.length !== 2 || !number(entry[0]) || !record(entry[1]))
        throw new Error("Invalid mob art observation");
      const actions: Record<string, { path: string; ox: number; oy: number }[]> = {};
      for (const [name, frames] of Object.entries(entry[1])) {
        if (!Array.isArray(frames)) throw new Error("Invalid mob action observation");
        actions[name] = frames.map((frame: unknown) => {
          if (
            !record(frame) ||
            typeof frame.path !== "string" ||
            !number(frame.ox) ||
            !number(frame.oy)
          )
            throw new Error("Invalid mob frame observation");
          return { path: frame.path, ox: frame.ox, oy: frame.oy };
        });
      }
      return [entry[0], actions];
    });
    return { camera: { x: value.camera.x, y: value.camera.y }, mobs, arts };
  }
  function packet(data: unknown): ProbePacket {
    if (typeof data !== "string") throw new Error("Expected a textual probe packet");
    const p: unknown = JSON.parse(data),
      at = performance.now();
    if (!record(p) || typeof p.t !== "string") throw new Error("Expected a packet object with t");
    switch (p.t) {
      case "move":
        if (
          !number(p.x) ||
          !number(p.y) ||
          !number(p.vx) ||
          !number(p.vy) ||
          !number(p.foothold) ||
          !number(p.action)
        )
          break;
        return {
          t: p.t,
          at,
          x: p.x,
          y: p.y,
          vx: p.vx,
          vy: p.vy,
          foothold: p.foothold,
          action: p.action,
        };
      case "field":
        if (!number(p.mapId)) break;
        return { t: p.t, at, mapId: p.mapId, self: self(p.self) };
      case "self":
        return { t: p.t, at, self: self(p.self) };
      case "inventory":
        return { t: p.t, at, inventory: inventory(p.inventory) };
      case "characters":
        if (!Array.isArray(p.characters)) break;
        return {
          t: p.t,
          at,
          characters: p.characters.map((c: unknown) => {
            if (
              !record(c) ||
              !number(c.id) ||
              typeof c.name !== "string" ||
              !number(c.str) ||
              !number(c.luk)
            )
              throw new Error("Invalid character observation");
            return { id: c.id, name: c.name, str: c.str, luk: c.luk };
          }),
        };
      case "mob-move":
        return { t: p.t, at, path: path(p.path) };
      case "user-look":
        if (p.avatarItems !== undefined && !numbers(p.avatarItems)) break;
        return { t: p.t, at, ...(numbers(p.avatarItems) ? { avatarItems: p.avatarItems } : {}) };
      case "create":
        if (!numbers(p.appearance)) break;
        return { t: p.t, at, appearance: p.appearance };
      case "created":
      case "deleted":
        if (typeof p.ok !== "boolean" || (p.id !== undefined && !number(p.id))) break;
        return { t: p.t, at, ok: p.ok, ...(number(p.id) ? { id: p.id } : {}) };
      case "delete-character":
        if (!number(p.id)) break;
        return { t: p.t, at, id: p.id };
      case "name-checked":
        if (!number(p.result)) break;
        return { t: p.t, at, result: p.result };
      case "change-slot":
        if (!number(p.count)) break;
        return { t: p.t, at, count: p.count };
      case "portal":
        if (typeof p.name !== "string") break;
        return { t: p.t, at, name: p.name };
      case "chat":
        if (typeof p.text !== "string") break;
        return { t: p.t, at, text: p.text };
      case "ability-result":
        if (typeof p.changed !== "boolean") break;
        return { t: p.t, at, changed: p.changed };
      case "login":
      case "world":
      case "character":
      case "ability-up":
      case "error":
        return { t: p.t, at };
      default:
        return { t: "other", kind: p.t, payload: p, at };
    }
    throw new Error(`Invalid ${p.t} observation`);
  }
  function observe(list: ProbePacket[], data: unknown) {
    try {
      append(list, packet(data));
    } catch (error) {
      append(state.invalid, error instanceof Error ? error.message : String(error), 100);
    }
  }
  const Socket = window.WebSocket;
  window.WebSocket = class extends Socket {
    constructor(...args: ConstructorParameters<typeof WebSocket>) {
      super(...args);
      this.addEventListener("message", (event: MessageEvent<unknown>) =>
        observe(state.messages, event.data),
      );
    }
    override send(data: Parameters<WebSocket["send"]>[0]) {
      observe(state.sent, data);
      super.send(data);
    }
  };
  const queries = new WeakMap<Blob, string>();
  const originalFetch = window.fetch;
  window.fetch = Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);
      const request = args[0],
        url = request instanceof Request ? request.url : String(request);
      if (new URL(url, location.href).pathname === "/api/avatar.png") {
        const blob = response.blob.bind(response);
        response.blob = async () => {
          const value = await blob();
          queries.set(value, url);
          return value;
        };
      }
      return response;
    },
    { preconnect: originalFetch.preconnect },
  );
  const create = URL.createObjectURL.bind(URL),
    revoke = URL.revokeObjectURL.bind(URL),
    blobHistory: string[] = [];
  URL.createObjectURL = (blob) => {
    const url = create(blob),
      query = blob instanceof Blob ? queries.get(blob) : undefined;
    state.activeBlobs.add(url);
    if (query) {
      state.blobSources[url] = query;
      blobHistory.push(url);
      if (blobHistory.length > 5000) {
        const oldest = blobHistory.shift();
        if (oldest) delete state.blobSources[oldest];
      }
    }
    return url;
  };
  URL.revokeObjectURL = (url) => {
    state.activeBlobs.delete(url);
    revoke(url);
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    raf((now) => {
      if (callback.name === "frame") {
        state.draws.length = 0;
        state.texts.length = 0;
      }
      callback(now);
    });
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (
    image: CanvasImageSource,
    ...args:
      | [number, number]
      | [number, number, number, number]
      | [number, number, number, number, number, number, number, number]
  ) {
    const src =
      image instanceof HTMLImageElement
        ? (state.blobSources[image.src] ?? decodeURIComponent(image.src))
        : "";
    const m = this.getTransform();
    const call: ProbeDraw = {
      src,
      args: [...args],
      canvas: [this.canvas.width, this.canvas.height],
      matrix: { a: m.a, e: m.e, f: m.f },
    };
    append(state.draws, call);
    if (src.includes("/miniMap/canvas")) append(state.miniBlits, call, 500);
    const bound = draw.bind(this);
    if (args.length === 2) bound(image, ...args);
    else if (args.length === 4) bound(image, ...args);
    else bound(image, ...args);
  };
  const fill = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (...args: Parameters<typeof fill>) {
    if (
      this.canvas.width === 257 &&
      this.canvas.height === 113 &&
      String(this.fillStyle).startsWith("rgba(255, 255, 0,")
    )
      append(state.miniMarks, [...args], 200);
    fill.apply(this, args);
  };
  const text = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof text>) {
    append(state.texts, { text: String(args[0]), x: args[1], y: args[2] });
    text.apply(this, args);
  };
  const Context = window.AudioContext;
  if (Context)
    window.AudioContext = class extends Context {
      override createBufferSource() {
        const source = super.createBufferSource(),
          start = source.start.bind(source);
        source.start = (...args: Parameters<typeof source.start>) => {
          append(state.audio, {
            loop: source.loop,
            duration: source.buffer?.duration,
            rate: source.buffer?.sampleRate,
            energy:
              source.buffer?.getChannelData(0).some((sample) => Math.abs(sample) > 0.001) ?? false,
            state: this.state,
          });
          start(...args);
        };
        return source;
      }
    };
}
