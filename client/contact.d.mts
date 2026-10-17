export interface ContactPoint {
  x: number;
  y: number;
}
export interface NativeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface CollisionFrame {
  bounds?: NativeRect;
}
export function intersects(a?: NativeRect, b?: NativeRect): boolean;
export function playerContactRect(
  point: ContactPoint,
  previous?: ContactPoint,
): NativeRect;
export function mobRect(
  frame: CollisionFrame | undefined,
  point: ContactPoint,
  flip?: boolean,
  previous?: ContactPoint,
): NativeRect | undefined;
export function mobContactRect(
  frame: CollisionFrame | undefined,
  point: ContactPoint,
  flip?: boolean,
  previous?: ContactPoint,
): NativeRect | undefined;
export function contactImpulse(
  player: ContactPoint,
  previousPlayer: ContactPoint,
  mob: ContactPoint,
  previousMob: ContactPoint,
): ContactPoint;
export function mergeImpulse(velocity: number, impulse: number): number;
export function contactClock(): {
  reset(): void;
  accept(damage: number): void;
  step(elapsed: number): boolean;
  readonly ready: boolean;
  readonly tinted: boolean;
  readonly remaining: number;
};
