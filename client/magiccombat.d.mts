import type {ContactPoint,NativeRect} from './contact.mjs';
export const MAGIC_NEAR:50, MAGIC_RANGE:300, MAGIC_HEIGHT:25;
export function magicSearchRects(source:ContactPoint,facingLeft:boolean):NativeRect[];
export function magicHitPoint(source:ContactPoint,facingLeft:boolean,rect:NativeRect):ContactPoint;
export function magicLeg(source:ContactPoint,facingLeft:boolean,point?:ContactPoint):{x0:number;y0:number;x1:number;y1:number;duration:number};
import type {FootholdSegment} from '../server/src/wz/archive.ts';
export function clipMagicRay(source:ContactPoint,point:ContactPoint,footholds:FootholdSegment[],group?:number):{point:ContactPoint;blocked:boolean};
