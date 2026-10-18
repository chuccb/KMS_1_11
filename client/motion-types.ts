import type { MoveElement } from "../server/src/protocol/movepath.ts";
import type {
  NormalizedSegment,
  PhysicalBounds,
  TerrainSegment,
  TerrainVelocity,
} from "./native-terrain.ts";
import type { NativeShoe, GroundAttributes, FieldAttributes } from "./native-locomotion.ts";
import type { PostureBody } from "./posture.ts";
import type { AvatarActor } from "./avatar-motion.ts";

export interface Ladder {
  id: number;
  x: number;
  y1: number;
  y2: number;
  ladder?: boolean;
  page?: number;
  upperFoothold?: boolean;
}
export interface CollisionMap {
  footholds?: readonly TerrainSegment[];
  ladders?: readonly Ladder[];
  physicalBounds?: PhysicalBounds;
}
export interface CollisionWorld {
  footholds: NormalizedSegment[];
  byId: Map<number, NormalizedSegment>;
  ladders: Ladder[];
  groundAttr: Readonly<GroundAttributes>;
  fieldAttr: Readonly<FieldAttributes>;
  bounds?: PhysicalBounds;
}
export interface MovementInput {
  horizontal?: number;
  vertical?: number;
  jump?: boolean;
  disabled?: boolean;
  allowClimb?: boolean;
  speedPercent?: number;
  jumpPercent?: number;
}
export type MovementSnapshot = Omit<MoveElement, "duration">;
export interface MovementFragment extends Pick<MoveElement, "x" | "y" | "foothold" | "duration"> {
  action?: number;
  attr?: number;
  vx?: number;
  vy?: number;
}
export interface RemoteMotion {
  start: number;
  x: number;
  y: number;
  foothold?: number;
  elements: MovementFragment[];
}
export interface MotionActor extends AvatarActor {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  action?: number;
  foothold?: number;
  layer?: number;
  group?: number;
  ladder?: Ladder;
  motion?: RemoteMotion;
}
export interface PlayerBody extends PostureBody, TerrainVelocity {
  groundSpeed: number;
  groundPosition: number;
  grounded: boolean;
  foothold: number;
  facing: number;
  layer: number;
  group: number;
  ladder?: Ladder;
  moveX: number;
  moveY: number;
  moveAttr?: number;
  jumpHeld: boolean;
  jumpQueued: boolean;
  groundJumps: number;
  accumulator: number;
  knockback?: { x: number; y: number };
  terrainTrace: { at: number; before: MovementSnapshot; after: MovementSnapshot }[];
  motionOrigin?: MovementSnapshot;
  motionFrames: MoveElement[];
}
export interface TerrainResolution {
  hit: boolean;
  remaining: number;
}
export type MovementShoe = NativeShoe;

export type DepthActor = Omit<MotionActor, "ladder"> & {
  ladder?: Omit<Ladder, "id"> & { id?: number };
};
