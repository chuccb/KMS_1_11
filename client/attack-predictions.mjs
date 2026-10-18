/** Browser/bridge correlation policy, NOT a native opcode, RNG stream or admission ACK.
 * Bounds only cap retained asynchronous UI work; they never alter native release/travel clocks.
 */
export const ATTACK_PREDICTION_LIMIT=128;
export const ATTACK_PREDICTION_TTL_MS=10000;
export function attackPredictions({now=()=>performance.now(),limit=ATTACK_PREDICTION_LIMIT,ttl=ATTACK_PREDICTION_TTL_MS}={}) {
  if(!Number.isInteger(limit)||limit<1||!Number.isFinite(ttl)||ttl<=0)throw new RangeError("Invalid attack prediction bounds");
  let sequence=0;
  const entries=new Map();
  const prune=()=>{const at=now();for(const [id,entry] of entries)if(at>=entry.expiry)entries.delete(id);};
  return {
    clear(){entries.clear();},
    add(context){
      prune();
      if(entries.size>=limit)entries.delete(entries.keys().next().value);
      sequence=sequence>=0x7fffffff?1:sequence+1;
      entries.set(sequence,{context:{...context,targets:new Map(context.targets)},expiry:now()+ttl});
      return sequence;
    },
    consume(id,mobId){
      prune();
      const entry=entries.get(id),target=entry?.context.targets.get(mobId);
      if(!target)return;
      entry.context.targets.delete(mobId);
      if(!entry.context.targets.size)entries.delete(id);
      return {...entry.context,target};
    },
  };
}
