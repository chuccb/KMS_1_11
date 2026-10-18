/**
 * One archive, one art cache: the object the web client hands every picture request to.
 *
 * The map renderer, the avatar composer and the NPC/mob sprite reader all decode canvases through
 * the same `ArtReader` (see `game/wzart.ts`). Sharing it matters: a field asks for the same tile
 * hundreds of times, and a test that draws two maps of the same tileset should not decode either
 * tileset twice. This module is also where the *process-wide* caches live (the `z` table, the
 * composed avatar PNGs), so `net/webclient.ts` stays a thin HTTP layer.
 */
import { avatarMotionOf, type AvatarMotionProfile } from "./avatarmotion.ts";
import type { WzArchive } from "../wz/archive.ts";
import { artReaderOf, type ArtReader } from "./wzart.ts";
import { mapArtProvider, type MapArt } from "./mapart.ts";
import { composeAvatar, zRanksOf, type AvatarFrame } from "./avatar.ts";
import { spriteLibrary } from "./sprites.ts";
import { basicAttackProvider, basicProjectileFrames } from "./basicattack.ts";
import { faceAnimationOf, type FaceAnimation } from "./face.ts";
import type { ArtProvider } from "../net/webclient.ts";

/** How many composed avatar frames one process keeps (a look x stance x frame x flip key). */
const AVATAR_CACHE_LIMIT = 512;

export function artProviderOf(archive: WzArchive): ArtProvider {
  const mapProvider = mapArtProvider(archive);
  const library = spriteLibrary(archive);
  const ranks = zRanksOf(archive);
  const reader = mapProvider.reader ?? library.reader;
  const avatars = new Map<string, AvatarFrame | undefined>();
  const motions = new Map<number, AvatarMotionProfile | undefined>();
  const faces = new Map<number, FaceAnimation | undefined>();

  return {
    reader,
    avatarMotion(weaponId: number) {
      if (!motions.has(weaponId)) {
        if (motions.size >= 64) motions.delete(motions.keys().next().value!);
        motions.set(weaponId, avatarMotionOf(reader, weaponId));
      }
      return motions.get(weaponId);
    },
    face(faceId: number) {
      if (!faces.has(faceId)) {
        if (faces.size >= 64) faces.delete(faces.keys().next().value!);
        faces.set(faceId, faceAnimationOf(reader, faceId));
      }
      return faces.get(faceId);
    },
    ...(reader === undefined
      ? {}
      : {
          attackProfile: basicAttackProvider(reader),
          projectile: (itemId: number) => basicProjectileFrames(reader, itemId),
        }),
    mapArt(mapId: number): MapArt | undefined {
      return mapProvider(mapId);
    },
    npc(templateId: number) {
      return library.npc(templateId);
    },
    mob(templateId: number) {
      return library.mob(templateId);
    },
    avatar(look, options) {
      const key = [
        look.face,
        look.hair,
        look.items.join("."),
        options.stance ?? "stand1",
        options.frame ?? 0,
        options.emotion ?? "",
        options.faceFrame ?? 0,
        options.flip === true ? "l" : "r",
        options.planes === true ? "planes" : "merged",
      ].join("|");
      if (avatars.has(key)) return avatars.get(key);
      const frame = composeAvatar(
        archive,
        { faceId: look.face, hairId: look.hair, items: look.items },
        {
          ...(options.stance !== undefined ? { stance: options.stance } : {}),
          ...(options.frame !== undefined ? { frame: options.frame } : {}),
          ...(options.emotion !== undefined ? { emotion: options.emotion } : {}),
          ...(options.faceFrame !== undefined ? { faceFrame: options.faceFrame } : {}),
          ...(options.flip !== undefined ? { flip: options.flip } : {}),
          ...(options.planes === true ? { planes: true } : {}),
          ranks,
          ...(reader !== undefined ? { reader } : {}),
        },
      );
      // A cheap eviction: drop the oldest half once the map is full, so a busy hour with many looks
      // does not grow without bound while a single character's frames stay cached.
      if (avatars.size >= AVATAR_CACHE_LIMIT) {
        let drop = Math.floor(AVATAR_CACHE_LIMIT / 2);
        for (const oldKey of avatars.keys()) {
          avatars.delete(oldKey);
          if (--drop <= 0) break;
        }
      }
      avatars.set(key, frame);
      return frame;
    },
  };
}

/** The reader alone, for a caller that only needs to resolve one canvas (`wz png`-style tools). */
export function sharedArtReader(archive: WzArchive): ArtReader | undefined {
  return artReaderOf(archive);
}
