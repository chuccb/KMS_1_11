/** Shared map values used by browser navigation and the native protocol/session layers. */

/**
 * WZ `info/returnMap` means no recovery destination: 25 of the 100 maps carry it, and
 * `Map/Map/999999999.img` does not exist (`analysis/map_meta.json`). It is not a destination id.
 */
export const RETURN_MAP_NONE = 999_999_999;

/** `0x0D` map commands carry the destination in an `s32` kind field. */
export const MAX_MAP_COMMAND_ID = 0x7fff_ffff;
