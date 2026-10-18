/**
 * NPC and mob pictures: the stance and frames the field draws, named the way the archive names them.
 *
 * An NPC (`Npc/<7-digit>.img`) carries `stand`, `move`, `blink`, `alert`, `smile`, `angry`; only
 * `stand` (and `move` for the few that walk) is what a field shows. A mob (`Mob/<7-digit>.img`)
 * carries `move`, `stand`, `hit1`, `die1`, `attack1`, … and an `info` block with the numbers
 * `game/mobs.ts` already reads.
 *
 * Nothing here decides *gameplay*: the frames are a presentation detail the 2003 server never sent
 * (the client picks the action from the packets it gets). The web view has no client-side mob AI, so
 * it asks this module for the frames to loop and draws them itself.
 */
import { entriesOf } from "../wz/props.ts";
import type { WzArchive } from "../wz/archive.ts";
import {
  artReaderOf,
  frameDelay,
  frameNames,
  frameAlpha,
  type ArtReader,
  vectorOf,
  nodeRecord,
} from "./wzart.ts";

/** One frame of one action. */
export interface SpriteFrame {
  path: string;
  delay: number;
  a0?: number;
  a1?: number;
  /** The canvas' `origin` - the pixel that lands on the entity's `(x, y)`. */
  ox: number;
  oy: number;
  /** Canvas metadata, NOT the collision rectangle. */
  width?: number;
  height?: number;
  /** 40B530 frame lt/rb -> 486260. Absence means SetRectEmpty, not canvas-sized fallback. */
  bounds?: { left: number; top: number; right: number; bottom: number };
}

/** An animated set of frames, e.g. a mob's `move` action. */
export interface Sprite {
  /** Left of the picture relative to the object's position (the origin is the anchor). */
  frames: SpriteFrame[];
}

/** The actions a field entity can be in, as the archive names them. */
export type SpriteAction = string;

/**
 * The frames of `image/<action>`, or of `fallbackAction` (`stand` then `move` by default) when the
 * entity does not have the one asked for. An empty list is a real answer: the image has no such
 * action and the caller has to draw something else.
 */
export function spriteFrames(
  reader: ArtReader,
  image: string,
  action: string,
  fallbacks: readonly string[] = ["stand", "move"],
  defaultDelay?: number,
): SpriteFrame[] {
  for (const candidate of [action, ...fallbacks]) {
    const node = reader.node(`${image}/${candidate}`);
    if (node === undefined) continue;
    const names = frameNames(node);
    const out: SpriteFrame[] = [];
    for (const name of names) {
      const path = name === "" ? `${image}/${candidate}` : `${image}/${candidate}/${name}`;
      const art = reader.at(path);
      if (art === undefined) continue;
      const props = entriesOf(reader.node(path)?.value);
      const lt = vectorOf(props.find((p) => p.name === "lt")?.value);
      const rb = vectorOf(props.find((p) => p.name === "rb")?.value);
      const delay = props.find((p) => p.name === "delay")?.value;
      out.push({
        ...(lt && rb ? { bounds: { left: lt[0], top: lt[1], right: rb[0], bottom: rb[1] } } : {}),
        path,
        ...frameAlpha(reader.node(path)),
        // Canvas properties are in node.value.props; nodeProperty(canvas, "delay") is empty.
        delay:
          typeof delay === "number" && Number.isFinite(delay)
            ? Math.max(1, delay)
            : frameDelay(
                node,
                name,
                defaultDelay ??
                  (image.startsWith("Mob/") || image.startsWith("Npc/") || candidate === "move"
                    ? 180
                    : 1000),
              ),
        ox: art.ox,
        oy: art.oy,
        width: art.width,
        height: art.height,
      });
    }
    if (out.length > 0) return out;
  }
  return [];
}

/** 48E360 attack<i>/info. Missing mandatory range vectors are NOT guessed from canvas size. */
export interface MobAttackArt {
  action: number;
  name: string;
  type: 0 | 1 | 2;
  conMP: number;
  duration: number;
  visualDuration: number;
  effectAfter: number;
  attackAfter: number;
  range?: { left: number; top: number; right: number; bottom: number };
  sp?: { x: number; y: number };
  radius?: number;
  effect: SpriteFrame[];
  hit: SpriteFrame[];
  ball: SpriteFrame[];
}
export function mobAttacksOf(
  reader: ArtReader,
  image: string,
  actions: Record<string, SpriteFrame[]>,
): MobAttackArt[] {
  const out: MobAttackArt[] = [];
  for (const [index, name] of ["attack1", "attack2", "attackF"].entries()) {
    const path = `${image}/${name}/info`,
      node = reader.node(path),
      body = actions[name];
    if (!node || !body?.length) continue;
    const info = nodeRecord(node),
      range = nodeRecord(reader.node(`${path}/range`));
    const number = (key: string) =>
      typeof info[key] === "number" && Number.isFinite(info[key])
        ? Math.trunc(info[key] as number)
        : 0;
    const type = number("type");
    if (type !== 0 && type !== 1 && type !== 2) continue;
    const lt = vectorOf(range.lt),
      rb = vectorOf(range.rb),
      sp = vectorOf(range.sp);
    if (
      type === 0
        ? !lt || !rb || lt[0] >= rb[0] || lt[1] >= rb[1]
        : !sp || typeof range.r !== "number" || !Number.isFinite(range.r) || range.r <= 0
    )
      continue;
    out.push({
      action: index + 10,
      name,
      type,
      conMP: Math.max(0, number("conMP")),
      duration: body.reduce((n, f) => n + f.delay, 0),
      visualDuration: body.reduce((n, f) => n + Math.max(30, Math.ceil(f.delay / 30) * 30), 0),
      effectAfter: number("effectAfter"),
      attackAfter: number("attackAfter"),
      ...(type === 0
        ? { range: { left: lt![0], top: lt![1], right: rb![0], bottom: rb![1] } }
        : { sp: { x: sp![0], y: sp![1] }, radius: Math.trunc(range.r as number) }),
      effect: spriteFrames(reader, path, "effect", [], 120),
      hit: spriteFrames(reader, path, "hit", [], 120),
      ball: spriteFrames(reader, path, "ball", [], 120),
    });
  }
  return out;
}

/** Every action of one image (`stand`, `move`, `hit1`, …) mapped to its frames. */
export function spriteActions(reader: ArtReader, image: string): Record<string, SpriteFrame[]> {
  const node = reader.node(image);
  const out: Record<string, SpriteFrame[]> = {};
  if (node === undefined || node.kind !== "props") return out;
  for (const entry of node.props) {
    const frames = spriteFrames(reader, image, entry.name, []);
    if (frames.length > 0) out[entry.name] = frames;
  }
  return out;
}

/** `Npc/<7-digit id>.img`. */
export function npcImagePath(templateId: number): string {
  return `Npc/${String(templateId).padStart(7, "0")}.img`;
}

/** `Mob/<7-digit id>.img` (the archive's own width, not the `info` id). */
export function mobImagePath(templateId: number): string {
  return `Mob/${String(templateId).padStart(7, "0")}.img`;
}

/** CNpc/NpcAttribute: own info owns name and dc bounds, even with linked action art. */
export interface NpcArt {
  templateId: number;
  name: string;
  clickBounds: { left: number; top: number; right: number; bottom: number };
  actions: Record<string, SpriteFrame[]>;
  behavior: NpcBehavior;
}

/** 49CBF0 defaults, not a guessed canvas-sized interaction target. */
export function npcClickBounds(info: Record<string, unknown>): NpcArt["clickBounds"] {
  const number = (key: string, fallback: number): number => {
    const value = info[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  };
  return {
    left: number("dcLeft", -22),
    top: number("dcTop", -65),
    right: number("dcRight", 22),
    bottom: number("dcBottom", 0),
  };
}

export interface NpcBehavior {
  /** Root move property exists after one-hop link substitution (49CBF0), not the controller flag. */
  movable: boolean;
  /** Dense 0..propertyCount-1 lookup, including empty/missing slots, as 49CBF0 does. */
  speak: string[];
  extraActions: { name: string; speak: string[] }[];
}

/** Resolve linked properties WITHOUT decoding canvas pixels. Own info never comes from the link. */
export function npcNodesOf(
  templateId: number,
  reader: ArtReader,
):
  | {
      info: Record<string, unknown>;
      actions: Map<string, string>;
    }
  | undefined {
  let image = npcImagePath(templateId);
  const info = nodeRecord(reader.node(`${image}/info`)),
    actions = new Map<string, string>(),
    seen = new Set<string>();
  for (;;) {
    const root = reader.node(image);
    if (seen.has(image) || seen.size >= 16 || !root || root.kind !== "props") return undefined;
    seen.add(image);
    for (const entry of root.props)
      if (entry.name.toLowerCase() !== "info") actions.set(entry.name, `${image}/${entry.name}`);
    const link = nodeRecord(reader.node(`${image}/info`)).link;
    if (typeof link !== "string") break;
    const id = Number.parseInt(link, 10);
    if (!Number.isSafeInteger(id) || id < 0) return undefined;
    image = npcImagePath(id);
  }
  return { info, actions };
}
function npcSpeechOf(value: unknown): string[] {
  const entries = entriesOf(value);
  return Array.from({ length: entries.length }, (_, i) => {
    const value = entries.find((entry) => entry.name === String(i))?.value;
    return typeof value === "string" ? value : "";
  });
}
export function npcBehaviorOf(templateId: number, reader: ArtReader): NpcBehavior | undefined {
  // 49CBF0 is NOT 40C020's action-art merge: it replaces the enumerated root with ONE linked
  // image, while retaining this NPC's original info. Own-only art is NOT another idle slot.
  let image = npcImagePath(templateId);
  const own = reader.node(image);
  if (!own || own.kind !== "props") return undefined;
  const info = nodeRecord(reader.node(`${image}/info`)),
    link = info.link;
  if (typeof link === "string") {
    const id = Number.parseInt(link, 10);
    if (!Number.isSafeInteger(id) || id < 0) return undefined;
    image = npcImagePath(id);
  }
  const root = reader.node(image);
  if (!root || root.kind !== "props") return undefined;
  const extraActions: NpcBehavior["extraActions"] = [];
  for (const entry of root.props) {
    if (["info", "stand", "move"].includes(entry.name.toLowerCase())) continue;
    extraActions.push({
      name: entry.name,
      speak: npcSpeechOf(nodeRecord(reader.node(`${image}/${entry.name}`)).speak),
    });
  }
  return {
    movable: root.props.some((entry) => entry.name === "move"),
    speak: npcSpeechOf(info.speak),
    extraActions,
  };
}
export function npcArtOf(templateId: number, reader: ArtReader): NpcArt | undefined {
  const nodes = npcNodesOf(templateId, reader);
  if (!nodes) return undefined;
  const actions: Record<string, SpriteFrame[]> = {};
  for (const [name, path] of nodes.actions) {
    const split = path.lastIndexOf("/");
    const frames = spriteFrames(reader, path.slice(0, split), path.slice(split + 1), []);
    if (frames.length) actions[name] = frames;
  }
  const behavior = npcBehaviorOf(templateId, reader)!;
  return Object.keys(actions).length === 0
    ? undefined
    : {
        templateId,
        name: typeof nodes.info.name === "string" ? nodes.info.name : "",
        clickBounds: npcClickBounds(nodes.info),
        actions,
        behavior,
      };
}

/** What the page needs to draw one mob: its id and its frames by action. */
export interface MobArt {
  templateId: number;
  bodyAttack?: boolean;
  attacks?: MobAttackArt[];
  maxMP?: number;
  /** Original own info.pushed (48D080 default1), not linked art info. */
  pushed?: number;
  actions: Record<string, SpriteFrame[]>;
}

export function mobArtOf(templateId: number, reader: ArtReader): MobArt | undefined {
  let image = mobImagePath(templateId);
  const info = nodeRecord(reader.node(`${image}/info`));
  // 40AE20 recursively loads action art via _wtoi(info.link); original info still owns contact.
  // Bound malformed/cyclic archives instead of recursing indefinitely.
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(image) || seen.size >= 16) return undefined;
    seen.add(image);
    const link = nodeRecord(reader.node(`${image}/info`)).link;
    if (typeof link !== "string") break;
    const id = Number.parseInt(link, 10);
    if (!Number.isSafeInteger(id) || id < 0) return undefined;
    image = mobImagePath(id);
  }
  const actions = spriteActions(reader, image);
  const bodyAttack = Number(info.bodyAttack ?? 0) !== 0;
  return Object.keys(actions).length === 0
    ? undefined
    : {
        templateId,
        actions,
        bodyAttack,
        pushed: Number(info.pushed ?? 1),
        maxMP: Number(info.maxMP ?? 0),
        attacks: mobAttacksOf(reader, image, actions),
      };
}

/** A cached `templateId -> art` reader for the web endpoint (`--data off` has none). */
export function spriteLibrary(archive: WzArchive | undefined): {
  reader: ArtReader | undefined;
  npc(templateId: number): NpcArt | undefined;
  mob(templateId: number): MobArt | undefined;
} {
  const reader = artReaderOf(archive);
  const npcs = new Map<number, NpcArt | undefined>();
  const mobs = new Map<number, MobArt | undefined>();
  return {
    reader,
    npc(templateId: number): NpcArt | undefined {
      if (reader === undefined) return undefined;
      if (!npcs.has(templateId)) npcs.set(templateId, npcArtOf(templateId, reader));
      return npcs.get(templateId);
    },
    mob(templateId: number): MobArt | undefined {
      if (reader === undefined) return undefined;
      if (!mobs.has(templateId)) mobs.set(templateId, mobArtOf(templateId, reader));
      return mobs.get(templateId);
    },
  };
}
