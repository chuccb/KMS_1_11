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
