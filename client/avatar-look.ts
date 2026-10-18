import type { BrowserLook } from "./image-cache.ts";

/** Local SelfView has explicit hair; remote 0x1C puts it first in avatarItemsOf's list. */
export interface AvatarLookSource {
  face?: number;
  hair?: number;
  avatarItems?: readonly number[];
}
/** Original existing preview defaults, not equipment grants or changes to the source character. */
export function lookOf(entity: AvatarLookSource | null | undefined): BrowserLook {
  if (!entity) return { face: 20000, hair: 30000, items: [] };
  if (typeof entity.hair === "number" && entity.hair !== 0)
    return { face: entity.face || 20000, hair: entity.hair, items: entity.avatarItems ?? [] };
  const list = entity.avatarItems ?? [];
  return { face: entity.face || 20000, hair: list[0] || 30000, items: list.slice(1) };
}
