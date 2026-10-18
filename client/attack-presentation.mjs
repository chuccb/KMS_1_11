/** Original 4BE270 / 40A5E0 / 40EA70 / 485B80 / 487A30 / 50D7F0 presentation facts.
 * Inputs are archive metadata/captured RECTs; not a port of the swept CShape2D pool. */
export const ATTACK_EFFECT_Z=250310; // 41F8A0, relative to tile base -1073721834.
export function weaponMasterySkills(weapon,shoot=false){
  const type=weapon>=1000000?Math.trunc(weapon/10000)%100:weapon;
  const ids=shoot?{45:[3100000],46:[3200000],47:[4100000]}:
    {30:[1100000,1200000],40:[1100000,1200000],31:[1100001],41:[1100001],32:[1200001],42:[1200001],33:[4200000],43:[1300000],44:[1300001]};
  return ids[type]??[];
}
export function attackMasteryTier(profile,levelOf,shoot=false){
  for(const id of weaponMasterySkills(profile.weaponId,shoot)){
    const rows=profile.masteryLevels?.[id]??[],level=Math.min(Math.max(0,Math.trunc(levelOf(id))),rows.length-1);
    const value=Math.max(0,Math.min(15,rows[level]??0));if(value)return value;
  }
  return 0;
}
/** Missing native tier/action art stays absent, never silently replaced with tier0. */
export function attackProfileAtTier(profile,tier=0){
  if(!profile)return;
  const select=action=>action&&({...action,
    ...(action.afterimages?{afterimage:action.afterimages[tier]??[]}:{}),
    ...(action.afterimageBounds?{bounds:action.afterimageBounds[tier]}:{})});
  return {...profile,afterimageTier:tier,melee:profile.melee.map(select),shoot:profile.shoot.map(select),
    ...(profile.prone?{prone:select(profile.prone)}:{})};
}
/** 40EA70 discards WZ delay/alpha, resets alpha255, 30ms per frame, last200ms -> alpha0. */
export function nativeAfterimageFrames(frames){
  return frames.map((frame,i)=>({...frame,delay:i===frames.length-1?200:30,a0:-1,a1:i===frames.length-1?0:-1}));
}
export function attackWorldRect(source,bounds,facingLeft){
  if(!bounds)return;
  return {left:source.x+(facingLeft?bounds.left:-bounds.right),right:source.x+(facingLeft?bounds.right:-bounds.left),
    top:source.y+bounds.top,bottom:source.y+bounds.bottom};
}
/** 485B80 extends a non-overlapping attack RECT just enough, then truncates the intersection centre. */
export function attackHitPoint(attack,rect){
  if(!attack||!rect||rect.left>=rect.right||rect.top>=rect.bottom)return;
  let {left,right,top,bottom}=attack;
  if(left>=rect.right)left=rect.right-1;else if(right<=rect.left)right=rect.left+1;
  if(top>=rect.bottom)top=rect.bottom-1;else if(bottom<=rect.top)bottom=rect.top+1;
  return {x:Math.trunc((Math.max(left,rect.left)+Math.min(right,rect.right))/2),
    y:Math.trunc((Math.max(top,rect.top)+Math.min(bottom,rect.bottom))/2)};
}
/** 4882F0 stores relative offset. 487A30 clamps it at IMPACT, then creates an unparented world layer. */
export function impactPosition(offset,mob,rect){
  if(!offset||!rect||rect.left>=rect.right||rect.top>=rect.bottom)return;
  return {x:Math.min(rect.right,Math.max(rect.left,mob.x+offset.x)),
    y:Math.min(rect.bottom,Math.max(rect.top,mob.y+offset.y))};
}
/** 50D7F0: skill hit paths take precedence; only physical families have a default spark. */
export function weaponHitKeys(weaponId,action){
  const type=Math.trunc(weaponId/10000)%100;
  const family=[30,31,33,40,41,43,44].includes(type)?'sword':[32,37,38,42,45,46,47].includes(type)?'mace':undefined;
  if(!family)return [];
  return [8,12,15,18,21,27,30].includes(action)?[`${family}F`]:[`${family}1`,`${family}2`];
}
