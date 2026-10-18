import type { NpcBehavior } from "../server/src/game/sprites.ts";
/** Native CNpc data/decisions shared by server validation and browser presentation.
 * 49A0C0 sends extraIndex+2; 49A280 compares the SIGNED received action directly to extraCount
 * and reads speech from extra[receivedAction], while 40C730 loads art from extra[action-2].
 * These are deliberately separate operations. Do NOT silently 'fix' either offset.
 * The server's transparent relay is a reconstruction policy, not a recovered original server.
 */
export const signedNpcByte = (n: number) => (n << 24) >> 24;
export function npcRandom(seed: number = 0) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 214013) + 2531011) >>> 0;
    return (state >>> 16) & 32767;
  };
}
export const npcIdleDelay = (rand: () => number) => (rand() % 8000) + 4000;
export function chooseNpcIdle(behavior: NpcBehavior, rand: () => number) {
  const extras = behavior.extraActions,
    stand = behavior.speak;
  const count = extras.length + stand.length;
  if (!count) return undefined;
  const pick = rand() % count;
  if (pick < extras.length) {
    const lines = extras[pick].speak;
    return {
      action: signedNpcByte(pick + 2),
      speech: lines.length ? signedNpcByte(rand() % lines.length) : -1,
    };
  }
  return { action: -1, speech: signedNpcByte(pick - extras.length) };
}
/** Checks a controller's REQUEST index space, not the receiver's different index space. */
export function validNpcRequest(behavior: NpcBehavior, action: number, speech: number) {
  if (
    !Number.isInteger(action) ||
    !Number.isInteger(speech) ||
    action < -128 ||
    action > 127 ||
    speech < -128 ||
    speech > 127
  )
    return false;
  // The sender writes bytes, so indices >=128 wrap negative. They are still legal requests;
  // 49A280 may then ignore them. Never strand the controller waiting for an acknowledgement.
  const slot = speech & 255;
  if (action === -1 && slot < behavior.speak.length) return true;
  return behavior.extraActions.some(
    (extra, index) =>
      signedNpcByte(index + 2) === action &&
      (extra.speak.length ? slot < extra.speak.length : speech === -1),
  );
}
/** Literal 49A280 recipient. Invalid action leaves the previous action AND bubble untouched. */
export function receiveNpcIdle(behavior: NpcBehavior, action: number, speech: number) {
  let name, text;
  if (action === -1) {
    if (speech >= 0 && speech < behavior.speak.length) text = behavior.speak[speech];
  } else if (action >= 0 && action < behavior.extraActions.length) {
    name = action === 0 ? "stand" : action === 1 ? "move" : behavior.extraActions[action - 2]?.name;
    const lines = behavior.extraActions[action].speak;
    if (speech >= 0 && speech < lines.length) text = lines[speech];
  }
  return { name, text };
}
/** 499D60 resets each frame's delay after a single 30ms decrement; overshoot is discarded. */
export const npcFrameDelay = (frame: { delay: number }) =>
  Math.max(30, Math.ceil(Math.max(1, Number.isFinite(frame.delay) ? frame.delay : 180) / 30) * 30);
export const npcActionDuration = (frames: readonly { delay: number }[] | undefined) =>
  (frames ?? []).reduce((sum, frame) => sum + npcFrameDelay(frame), 0);

/** 499B70 + 499900: wire low bit selects facing; put_flip is (bit == 0), NOT velocity sign. */
export function npcMovementPose(action: number) {
  return {
    name: action >> 1 === 2 ? "move" : "stand",
    facing: action & 1,
    flip: (action & 1) === 0,
  };
}
