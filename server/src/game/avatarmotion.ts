/** Ordinary avatar actions, not attack actions or movement physics.
 * 407A10: body delays (default150), 427BF0/40D950: idle ping-pong;
 * 409C30 -> 508290 -> 508FC0 (UI: 425060): weapon info.walk / info.stand.
 */
import { frameNames, nodeRecord, type ArtReader } from "./wzart.ts";
export const AVATAR_MOTION_ACTIONS = [
  "walk1",
  "walk2",
  "stand1",
  "stand2",
  "alert",
  "prone",
  "fly",
  "jump",
  "ladder",
  "rope",
  "dead",
] as const;
export interface AvatarMotionProfile {
  weaponId: number;
  walk: "walk1" | "walk2";
  stand: "stand1" | "stand2";
  /** Playback sequence; idle reverse entries share the original numeric WZ frame index. */
  actions: Record<string, { frames: { index: number; delay: number }[] }>;
}
/** 407A10 / listing407C8B: missing/unconvertible delay150, NOT the mob default180. */
export function nativeBodyFrameDelay(raw: unknown): number {
  const n =
    typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "") ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : 150;
}
const bodies = new WeakMap<ArtReader, AvatarMotionProfile["actions"]>();
export function avatarMotionOf(
  reader: ArtReader | undefined,
  weaponId: number,
): AvatarMotionProfile | undefined {
  if (
    !reader ||
    !Number.isInteger(weaponId) ||
    (weaponId !== 0 && (weaponId < 1300000 || weaponId >= 1500000))
  )
    return undefined;
  const weapon = `Character/Weapon/${String(weaponId).padStart(8, "0")}.img`;
  if (weaponId !== 0 && !reader.node(weapon)) return undefined;
  let actions = bodies.get(reader);
  if (!actions) {
    actions = {};
    for (const stance of AVATAR_MOTION_ACTIONS) {
      const path = `Character/00002000.img/${stance}`;
      const frames = frameNames(reader.node(path)).map((index) => {
        const raw = nodeRecord(reader.node(`${path}/${index}`)).delay;
        return { index: Number(index), delay: nativeBodyFrameDelay(raw) };
      });
      if (frames.length === 0) continue;
      const pingPong = ["stand1", "stand2", "alert"].includes(stance);
      actions[stance] = {
        frames:
          pingPong && frames.length > 1 ? [...frames, ...frames.slice(1, -1).reverse()] : frames,
      };
    }
    if (!actions.walk1 || !actions.stand1) return undefined;
    bodies.set(reader, actions);
  }
  const info = nodeRecord(reader.node(`${weapon}/info`));
  // Native missing WEAPONITEM (unarmed) =>1/1; present item uses !=1 to choose the second stance.
  return {
    weaponId,
    walk: weaponId === 0 || Number(info.walk) === 1 ? "walk1" : "walk2",
    stand: weaponId === 0 || Number(info.stand) === 1 ? "stand1" : "stand2",
    actions,
  };
}
