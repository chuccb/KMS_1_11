export interface NativeShoe { mass: number; walkForce: number; walkSpeed: number; walkDrag: number; slip: number; jump: number; }
export interface GroundAttributes { walk: number; drag: number; }
export interface FieldAttributes { drag: number; gravity: number; }
export const NATIVE_SHOE: Readonly<NativeShoe>;
export const NATIVE_FOOTHOLD: Readonly<GroundAttributes>;
export const NATIVE_FLUID: Readonly<FieldAttributes>;
export const NATIVE_STEP_MS: 30;
export function groundStep(speed: number, sin: number, horizontal: number, seconds: number, shoe?: NativeShoe, attr?: GroundAttributes): {speed: number; distance: number};
export function airStep(vx: number, vy: number, horizontal: number, seconds: number, shoe?: NativeShoe, field?: FieldAttributes): {vx: number; vy: number; dx: number; dy: number};
export function jumpVelocity(vx: number, sin: number, horizontal: number, shoe?: NativeShoe, attr?: GroundAttributes, field?: FieldAttributes): {vx: number; vy: number};
