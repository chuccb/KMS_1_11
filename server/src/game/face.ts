/** CActionMan::FACELOOKENTRY (408400), CUser::SetFace (509790), 509070/509560/50B590.
 * Face frames have their OWN delay/clock. Body animation speed is not a face animation speed.
 */
import type { ArtReader } from "./wzart.ts";
import { frameNames, nodeRecord } from "./wzart.ts";
import { EMOTION_NAMES } from "../protocol/field.ts";

export const FACE_EMOTIONS = EMOTION_NAMES;
export const faceImagePath = (id: number): string =>
  `Character/Face/${String(id).padStart(8, "0")}.img`;
export interface FaceAnimation {
  faceId: number;
  actions: Record<string, { duration: number; frames: { index: number; delay: number }[] }>;
}

export function faceAnimationOf(
  reader: ArtReader | undefined,
  faceId: number,
): FaceAnimation | undefined {
  if (!reader || !Number.isSafeInteger(faceId) || faceId < 0 || faceId > 99999999) return undefined;
  const image = faceImagePath(faceId);
  if (!reader.node(image)) return undefined;
  const actions: FaceAnimation["actions"] = {};
  for (const name of FACE_EMOTIONS) {
    const path = `${image}/${name}`,
      node = reader.node(path);
    if (!node) continue;
    const value = nodeRecord(node).delay;
    const frames = frameNames(node).flatMap((frame) => {
      if (!reader.at(`${path}/${frame}/face`)) return [];
      const raw = nodeRecord(reader.node(`${path}/${frame}`)).delay;
      // 408A7B converts the frame delay variant. Zero isn't absence; 1ms is browser safety.
      const delay =
        typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "")
          ? Number(raw)
          : NaN;
      return [
        {
          index: Number(frame),
          delay: Number.isFinite(delay) ? Math.max(1, Math.trunc(delay)) : 60,
        },
      ];
    });
    if (frames.length)
      actions[name] = {
        duration:
          typeof value === "number" && Number.isFinite(value)
            ? Math.max(0, Math.trunc(value))
            : 5000,
        frames,
      };
  }
  return actions.blink ? { faceId, actions } : undefined;
}

/** Exact numeric face frame; never silently substitute emotion frame0 for a missing later frame.
 * Native neutral is blink/0. default is retained solely for a look without that original node.
 */
export function faceFramePath(
  reader: ArtReader,
  image: string,
  emotion: string | undefined,
  frame: number,
): string | undefined {
  const action = emotion === undefined || emotion === "default" ? "blink" : emotion;
  if (
    !(FACE_EMOTIONS as readonly string[]).includes(action) ||
    !Number.isInteger(frame) ||
    frame < 0 ||
    frame > 255
  )
    return undefined;
  const path = `${image}/${action}/${frame}`;
  if (reader.node(path)) return path;
  return action === "blink" && frame === 0 && reader.node(`${image}/default`)
    ? `${image}/default`
    : undefined;
}
