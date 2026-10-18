export const ATTACK_PREDICTION_LIMIT:number;
export const ATTACK_PREDICTION_TTL_MS:number;
export interface AttackPredictionContext {
  targets:ReadonlyMap<number,unknown>;
  [key:string]:unknown;
}
export function attackPredictions(options?:{now?:()=>number;limit?:number;ttl?:number}):{
  clear():void;
  add(context:AttackPredictionContext):number;
  consume(id:number,mobId:number):(AttackPredictionContext&{target:unknown})|undefined;
};
