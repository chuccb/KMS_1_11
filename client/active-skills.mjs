/** PE 518BF0 dispatch whitelist. Archive presence is NOT proof of an implemented skill. */
export const ACTIVE_SKILLS = Object.freeze({
  1001003: {kind:'buff'}, 2001003: {kind:'buff'}, 3001003: {kind:'buff'},
  1101006: {kind:'buff', party:true},
  3001004:{kind:'ranged'},3001005:{kind:'ranged'},4001344:{kind:'ranged'},
  1001004: {kind:'melee'}, 1001005: {kind:'melee'}, 4001334: {kind:'melee'},
});
export const activeSkill = id => Number.isInteger(id)?ACTIVE_SKILLS[id]:undefined;
/** 4BE8B0: Double Stab subtracts ONE from weapon speed before clamping, not a fixed speed. */
export function activeSkillSpeed(speed,id,booster=0) {return Math.max(0,Math.min(6,speed-(id===4001334?1:0)-booster));}
/** 427F60: Double Stab requires dagger33/group1, uses stabO1 or stabO2. */
export function activeMeleeActions(profile,id) {
  if(activeSkill(id)?.kind!=='melee' || !profile) return [];
  if(id===4001334 && Math.trunc(profile.weaponId/10000)%100!==33) return [];
  return profile.melee.filter(a=>id!==4001334 || [16,17].includes(a.action));
}
/** 511630/513C80: one sufficiently large stack, bulletCount projectiles, attackCount hits per projectile. */
export function activeSkillAmmo(values) {return Math.max(1,Math.min(15,Math.trunc(values.bulletCount??1)));}
export function activeSkillHits(values,ranged=false) {
  return Math.min(15,Math.max(1,Math.trunc(values.attackCount??1))*(ranged?activeSkillAmmo(values):1));
}
export function activeRangedActions(profile,id) {
  if(activeSkill(id)?.kind!=='ranged'||!profile)return [];
  const type=Math.trunc(profile.weaponId/10000);
  return (id===4001344?type===147:[145,146].includes(type))?profile.shoot:[];
}
/** 513C80: 14px between endpoints, 120ms launch spacing for stars ONLY. */
export function activeProjectileLayout(count,star=false) {
  count=Math.max(1,Math.min(15,Math.trunc(count)));
  return Array.from({length:count},(_,i)=>({
    offsetY:7*(2*i-count+1),delayMs:star?120*i:0,
  }));
}
/** 512F90: a nonzero range extends the FAR edge only AFTER finding a target in the base rect. */
export function activeMeleeBounds(bounds,range,facingLeft,hasNearTarget) {
  if(!bounds || !range || !hasNearTarget) return bounds;
  // Bounds are native left-facing; the caller mirrors them, not this function.
  return {...bounds,left:Math.min(bounds.left,-range)};
}
export function activeSkillCost(stats,values) {
  const hp=values.hpCon??0,mp=values.mpCon??0;
  if(!Number.isInteger(hp)||!Number.isInteger(mp)||hp<0||mp<0||stats.hp<=hp||stats.mp<mp) return undefined;
  // 4BDDC0: HP must remain >0; consuming the last MP is allowed.
  return {hp:stats.hp-hp,mp:stats.mp-mp};
}
