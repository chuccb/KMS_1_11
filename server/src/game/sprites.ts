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
import { artReaderOf, frameDelay, frameNames, frameAlpha, type ArtReader, vectorOf, nodeRecord } from "./wzart.ts";

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
      const path =
        name === "" ? `${image}/${candidate}` : `${image}/${candidate}/${name}`;
      const art = reader.at(path);
      if (art === undefined) continue;
      const props = entriesOf(reader.node(path)?.value);
      const lt = vectorOf(props.find((p) => p.name === "lt")?.value);
      const rb = vectorOf(props.find((p) => p.name === "rb")?.value);
      const delay = props.find((p) => p.name === "delay")?.value;
      out.push({
        ...(lt && rb
          ? { bounds: { left: lt[0], top: lt[1], right: rb[0], bottom: rb[1] } }
          : {}),
        path,
        ...frameAlpha(reader.node(path)),
        // Canvas properties are in node.value.props; nodeProperty(canvas, "delay") is empty.
        delay:
          typeof delay === "number" && Number.isFinite(delay)
            ? Math.max(1, delay)
            : frameDelay(
                node,
                name,
                defaultDelay ?? (image.startsWith("Mob/") || candidate === "move" ? 180 : 1000),
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

/** What the page needs to draw one NPC: its id and its frames by action. */
export interface NpcArt {
  templateId: number;
  actions: Record<string, SpriteFrame[]>;
}

export function npcArtOf(templateId: number, reader: ArtReader): NpcArt | undefined {
  const image = npcImagePath(templateId);
  const actions = spriteActions(reader, image);
  return Object.keys(actions).length === 0 ? undefined : { templateId, actions };
}

/** What the page needs to draw one mob: its id and its frames by action. */
export interface MobArt {
  templateId: number;
  bodyAttack?: boolean;
  actions: Record<string, SpriteFrame[]>;
}

export function mobArtOf(
  templateId: number,
  reader: ArtReader,
): MobArt | undefined {
  const image = mobImagePath(templateId);
  const actions = spriteActions(reader, image);
  const bodyAttack =
    Number(nodeRecord(reader.node(`${image}/info`)).bodyAttack ?? 0) !== 0;
  return Object.keys(actions).length === 0
    ? undefined
    : { templateId, actions, bodyAttack };
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
