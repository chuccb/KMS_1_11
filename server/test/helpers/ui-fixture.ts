import { readFileSync } from "node:fs";
import type { HtmlImageLookup } from "../../../client/ui-types.ts";

/** Deliberately small component-only DOM. No WebSocket, character, disk storage or live service.
 * Assertions at the mock boundary do not weaken the production DOM/resource contracts.
 */
class Classes {
  private readonly values = new Set<string>();
  add(...names: string[]) {
    for (const name of names) this.values.add(name);
  }
  remove(...names: string[]) {
    for (const name of names) this.values.delete(name);
  }
  contains(name: string) {
    return this.values.has(name);
  }
  toggle(name: string, force = !this.values.has(name)) {
    if (force) this.values.add(name);
    else this.values.delete(name);
    return force;
  }
}
export function fixtureEvent(
  type: string,
  fields: Record<string, string | number | boolean> = {},
): Event {
  return Object.assign(new Event(type, { cancelable: true, bubbles: true }), {
    button: 0,
    detail: 0,
    clientX: 0,
    clientY: 0,
    ...fields,
  });
}
class FixtureDocument extends EventTarget {
  readonly elements = new Map<string, FixtureElement>();
  readonly root = new FixtureElement("fixture-root", this);
  activeElement: FixtureElement | null = null;
  hidden = false;
  getElementById(id: string) {
    return this.elements.get(id) ?? null;
  }
  createElement(tag: string) {
    return new FixtureElement(tag, this);
  }
}
export class FixtureElement extends EventTarget {
  readonly localName: string;
  readonly ownerDocument: FixtureDocument;
  readonly classList = new Classes();
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: FixtureElement[] = [];
  parentElement: FixtureElement | undefined;
  id = "";
  disabled = false;
  hidden = false;
  open = false;
  checked = false;
  value = "";
  textContent = "";
  title = "";
  type = "";
  tabIndex = 0;
  width = 800;
  height = 600;
  naturalWidth = 12;
  naturalHeight = 12;
  maxLength = 0;
  inputMode = "";
  validationMessage = "";
  constructor(tag: string, document: FixtureDocument) {
    super();
    this.localName = tag;
    this.ownerDocument = document;
  }
  get isConnected(): boolean {
    return this === this.ownerDocument.root || !!this.parentElement?.isConnected;
  }
  append(...elements: FixtureElement[]) {
    for (const element of elements) {
      element.parentElement = this;
      this.children.push(element);
      if (this.localName === "select" && this.children.length === 1) this.value = element.value;
    }
  }
  appendChild(element: FixtureElement) {
    this.append(element);
    return element;
  }
  replaceChildren(...elements: FixtureElement[]) {
    for (const child of this.children) child.parentElement = undefined;
    this.children.length = 0;
    this.append(...elements);
  }
  contains(element: unknown): boolean {
    return (
      element instanceof FixtureElement &&
      (element === this || this.children.some((child) => child.contains(element)))
    );
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
    if (key === "id") {
      this.id = value;
      this.ownerDocument.elements.set(value, this);
    }
    if (key === "class") this.classList.add(...value.split(/\s+/));
    if (key === "value") this.value = value;
    if (key === "disabled") this.disabled = true;
    if (key === "checked") this.checked = true;
  }
  getAttribute(key: string) {
    if (key.startsWith("data-"))
      return (
        this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())] ??
        null
      );
    return this.attributes.get(key) ?? null;
  }
  removeAttribute(key: string) {
    this.attributes.delete(key);
  }
  focus() {
    this.ownerDocument.activeElement?.blur();
    this.ownerDocument.activeElement = this;
    this.dispatchEvent(new Event("focus"));
  }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
    this.dispatchEvent(new Event("blur"));
  }
  click() {
    if (!this.disabled) this.dispatchEvent(fixtureEvent("click"));
  }
  select() {}
  setCustomValidity(reason: string) {
    this.validationMessage = reason;
  }
}
export function uiFixture() {
  const document = new FixtureDocument(),
    window = new EventTarget(),
    values = new Map<string, string>();
  const responses = new Map<string, unknown>(),
    draws: { kind: string; args: unknown[] }[] = [];
  let now = 0;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const stack = [document.root],
    voidTags = new Set([
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "param",
      "source",
      "track",
      "wbr",
    ]);
  const html = readFileSync(new URL("../../../client/index.html", import.meta.url), "utf8").replace(
    /<!--[\s\S]*?-->/g,
    "",
  );
  for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const [, closing, tag, attrs] = match;
    if (closing) {
      if (stack.at(-1)?.localName === tag) stack.pop();
      continue;
    }
    const element = document.createElement(tag);
    for (const attr of attrs.matchAll(/([a-zA-Z_:][-\w:.]*)(?:="([^"]*)")?/g))
      element.setAttribute(attr[1], attr[2] ?? "");
    stack.at(-1)!.append(element);
    if (!voidTags.has(tag)) stack.push(element);
  }
  const ctx = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    textBaseline: "",
    textAlign: "",
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    clip() {},
    translate() {},
    scale() {},
    setLineDash() {},
    rect(...args: number[]) {
      draws.push({ kind: "rect", args });
    },
    clearRect(...args: number[]) {
      draws.push({ kind: "clearRect", args });
    },
    fillRect(...args: number[]) {
      draws.push({ kind: "fillRect", args });
    },
    strokeRect(...args: number[]) {
      draws.push({ kind: "strokeRect", args });
    },
    fillText(...args: unknown[]) {
      draws.push({ kind: "fillText", args });
    },
    drawImage(...args: unknown[]) {
      draws.push({ kind: "drawImage", args });
    },
    measureText(text: string) {
      return { width: Array.from(text).length * 6 };
    },
  };
  const image: HtmlImageLookup = () => ({
    ready: true,
    img: document.createElement("img") as unknown as HTMLImageElement,
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    document,
    window,
    localStorage: storage,
    Node: FixtureElement,
    Element: FixtureElement,
    HTMLElement: FixtureElement,
    performance: { now: () => now },
    fetch: async (request: RequestInfo | URL) => {
      const path =
        typeof request === "string"
          ? request
          : request instanceof URL
            ? request.pathname
            : request.url;
      return responses.has(path)
        ? Response.json(responses.get(path))
        : Response.json({ error: `Unregistered component fixture: ${path}` }, { status: 404 });
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
  return {
    document,
    window,
    image,
    storage,
    draws,
    ctx: ctx as unknown as CanvasRenderingContext2D,
    respond(path: string, data: unknown) {
      responses.set(path, data);
    },
    time(value: number) {
      now = value;
    },
    key(key: string) {
      window.dispatchEvent(fixtureEvent("keydown", { key }));
    },
    get(id: string) {
      const element = document.getElementById(id);
      if (!element) throw new Error(`Unknown fixture id: ${id}`);
      return element;
    },
    menuButton(label: string) {
      const root = document.getElementById("game-ui");
      const menu = root?.children.find((child) => child.id === "system-menu");
      const button = menu?.children.find((child) => child.getAttribute("aria-label") === label);
      if (!button) throw new Error(`Unknown menu control: ${label}`);
      return button;
    },
    restore() {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}
