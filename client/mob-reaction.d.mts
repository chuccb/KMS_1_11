export const MOB_PUSH_SPEED:130;
export const MOB_PUSH_DRAG:400;
export interface ReactionTemplate {pushed?:number;hitActions?:number[];hitDurations?:Record<number,number>}
export interface MobReaction {duration:number;action:number;facing:number;velocity:number}
export interface ReactionPoint {x:number;y:number;vx:number;vy:number;foothold:number;action:number;duration:number}
export function mobHitAction(template:ReactionTemplate|undefined,rand?:()=>number):number;
export function mobReaction(template:ReactionTemplate|undefined,damage:number,hitAction:number,facingLeft:boolean,now:number,until?:number):MobReaction|undefined;
export function planMobReactionPath(start:{x:number;y:number;foothold:number},footholds:readonly {id:number;x1:number;x2:number;y1:number;y2:number;prev:number;next:number}[],reaction:MobReaction,ability?:number):ReactionPoint[];
export function nativeMobActions<T extends {delay:number;rawDelay?:number}>(actions:Record<string,T[]>):Record<string,(T&{rawDelay:number})[]>;
export function mobHitPose<T extends {delay:number;rawDelay?:number}>(actions:Record<string,T[]>|undefined,hit:{action:number;since:number;facing:number}|undefined,now:number):{frames:T[];elapsed:number;facing:number}|undefined;

export function mobHitName(action:number):'hit1'|'hit2'|'hitF'|undefined;
