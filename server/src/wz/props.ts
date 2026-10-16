/**
 * Reading WZ property trees without a type checker: the few conversions the game modules share.
 *
 * A parsed image is a tree of plain objects plus `WzEntry[]` property lists (`wz/img.ts`), and the
 * game modules only ever ask it three questions: *what properties does this node have*, *what does
 * one of them hold*, and *is this value the number/string I expect*. Each of those was written three
 * times (`game/map.ts`, `game/mobs.ts`, and now `game/npcs.ts`), which is how two modules end up
 * disagreeing about what a missing `info.level` means - so they live here once, with the rule
 * written down: **a value of the wrong shape is not a value**, and every caller has to say what it
 * wants instead.
 */

/** One `name : type = value` pair of a property list. */
export interface WzPropertyEntry {
  name: string;
  value: unknown;
}

/**
 * The property list of a `Property`-shaped node, or `[]`.
 *
 * Accepts anything, including `undefined` and plain fixtures, because the callers run both against
 * a real archive and against hand-written test data.
 */
export function entriesOf(node: unknown): WzPropertyEntry[] {
  if (node === null || typeof node !== "object") return [];
  const props = (node as { props?: unknown }).props;
  return Array.isArray(props) ? (props as WzPropertyEntry[]) : [];
}

/** The value of `name` inside a property list; `undefined` when the list does not have it. */
export function propertyOf(node: unknown, name: string): unknown {
  for (const entry of entriesOf(node)) if (entry.name === name) return entry.value;
  return undefined;
}

/** A number, or `fallback` when the value is missing or of the wrong type. */
export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

/** A string, or `fallback` when the value is missing or of the wrong type. */
export function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * `info` of a top-level object as a plain record - the shape every `Mob/*.img`, `Npc/*.img` and map
 * image starts with. Missing `info` gives `{}`, which makes every field inside it `undefined` and
 * therefore a caller-visible default rather than an exception.
 */
export function infoOf(root: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of entriesOf(propertyOf(root, "info"))) out[entry.name] = entry.value;
  return out;
}
