/**
 * WZ path builders - the strings the client itself uses to find map data.
 *
 * These are not guesses: each one is a literal in the 2003 client (UTF-16 in the binary, see
 * FINDINGS 4.11.2), which is why the server can address the *same* files the original client
 * loads. Only the paths that have been located in code are listed; when the resource pipeline
 * needs more, they get added here with their binary evidence.
 */

/**
 * `L"Map/Map/%09d.img"` (`sub_4694F0`) - the map file for a map id, zero-padded to nine digits.
 *
 * This is what makes `CharacterData.mapId` meaningful: the server sends a map id, the client
 * formats this path and loads that `.img`. `mapImagePath(1000000)` is `"Map/Map/001000000.img"`.
 */
export function mapImagePath(mapId: number): string {
  if (!Number.isInteger(mapId) || mapId < 0) throw new RangeError(`map id must be a non-negative integer, got ${mapId}`);
  return `Map/Map/${String(mapId).padStart(9, "0")}.img`;
}

/**
 * `L"Mob/%07d.img"` (`sub_40AE20`: `sub_411E50(&buf, "Mob/%07d.img", templateId)`, the mob's action
 * loader) - the mob image for a template id, zero-padded to seven digits.
 *
 * This is the id `life.id` carries and `0x2F`'s `templateId` names: `"0120100"` -> 120100 ->
 * `"Mob/0120100.img"`. `sub_4A1720` does the same for NPCs (`Npc/%07d.img`).
 */
export function mobImagePath(templateId: number): string {
  if (!Number.isInteger(templateId) || templateId < 0) {
    throw new RangeError(`mob template id must be a non-negative integer, got ${templateId}`);
  }
  return `Mob/${String(templateId).padStart(7, "0")}.img`;
}

/** The map `.img`'s sub-nodes, in the order `sub_469980` reads them (all three are required). */
export const MAP_NODES = {
  /** `L"foothold"` - the walkable platforms, addressed as `foothold/<group>/<id>`. */
  foothold: "foothold",
  /** `L"ladderRope"` - ladders and ropes. */
  ladderRope: "ladderRope",
  /** `L"portal"` - spawn points/portals (`sub_4A4430` also reads this node). */
  portal: "portal",
} as const;

/** `L"Map/MapHelper.img"` (`sub_46E7C0`) - map-wide helpers: `weather`, `rain`, `snow`, `cloud`. */
export const MAP_HELPER_PATH = "Map/MapHelper.img";

/** `L"Map/MapHelper.img/mark/"` plus `"mapName"`/`"streetName"` (`sub_46DA30`). */
export const MAP_HELPER_MARK_PREFIX = "Map/MapHelper.img/mark/";
