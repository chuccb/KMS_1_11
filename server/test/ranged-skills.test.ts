/** Regression SOURCES ONLY — NOT executed, typechecked, browser/VM/probe validated. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {WzArchive} from '../src/wz/archive.ts';
import {itemCatalogOf} from '../src/game/iteminfo.ts';
import {planRangedPreparation} from '../src/game/rangedpreview.ts';
import {artReaderOf} from '../src/game/wzart.ts';
import {skillCatalogOf} from '../src/game/skills.ts';
import {validatedActiveRanged,activeArt} from '../src/game/activeskills.ts';
import {firstBasicAmmo,planBasicAmmo,spendBasicAmmo,basicAttackProvider,validatedBasicAttack} from '../src/game/basicattack.ts';
import {emptyCharacterItems,characterDataOf,zeroStats} from '../src/protocol/chardata.ts';
import {equipSlot,nonEquipSlot} from '../src/protocol/itemslot.ts';
import {PacketReader} from '../src/protocol/packet.ts';
import {encodeStatUpdate,readStatUpdate} from '../src/protocol/stat.ts';
import {encodeClientAttack,readClientAttack,encodeUserAttack,readUserAttack,type ClientAttack} from '../src/protocol/field.ts';
import {activeSkillAmmo,activeSkillHits,activeSkillSpeed,activeRangedActions,activeProjectileLayout} from '../../client/active-skills.mjs';
import {temporaryStats} from '../../client/temporarystats.mjs';
import {statBasis,statTotals} from '../../client/characterstats.mjs';
import {nativeUniform,rollNativePhysical,type PhysicalAttackTrace} from '../src/game/nativecombat.ts';
const archive=()=>WzArchive.open(resolve(import.meta.dirname,'../../Data.wz'));
const bag=(weapon=1452000)=>{const items=emptyCharacterItems();items.worn.set(11,equipSlot(weapon));items.inventories[1]!.capacity=24;return items;};
const character=(id:number,weapon:number,ammo:number,quantity=5)=>{
  const items=bag(weapon);items.inventories[1]!.items.set(4,nonEquipSlot(ammo,quantity));items.map32=[{key:id,value:1}];
  return characterDataOf({...zeroStats(),id:123,name:'Ranged',job:400,level:20,str:40,dex:80,int:4,luk:100,hp:500,maxHp:500,mp:500,maxMp:500},items);
};
test('511630 requires ONE sufficiently large stack in numeric slot order, not combined small stacks',()=>{
  const items=bag(),use=items.inventories[1]!.items;
  use.set(7,nonEquipSlot(2060000,3));use.set(1,nonEquipSlot(2060000,1));use.set(2,nonEquipSlot(2060000,1));
  assert.deepEqual(firstBasicAmmo(items,2),{slot:7,itemId:2060000});
  assert.deepEqual(firstBasicAmmo(items),{slot:1,itemId:2060000});
  const before=[...use];assert.equal(spendBasicAmmo(items,1,2),undefined);assert.deepEqual([...use],before);
  use.delete(7);assert.equal(firstBasicAmmo(items,2),undefined);
  for(const count of [0,-1,16,NaN,1.5])assert.equal(firstBasicAmmo(items,count),undefined);
});
test('multi-arrow clear / rechargeable zero / no mutation until the pre-encoded transaction commits',()=>{
  for(const [weapon,ammo,clear] of [[1452000,2060000,true],[1462000,2061000,true],[1472000,2070000,false]] as const){
    const items=bag(weapon),use=items.inventories[1]!.items;use.set(4,nonEquipSlot(ammo,2));
    const before=[...use],plan=planBasicAmmo(items,4,2)!;
    assert.equal(plan.itemId,ammo);assert.deepEqual([...use],before);
    plan.apply();assert.equal(use.has(4),!clear);
    if(!clear)assert.deepEqual(use.get(4),nonEquipSlot(ammo,0));
  }
});
test('513C80 bulletCount * attackCount, each missing/zero count means one, cap15',()=>{
  assert.equal(activeSkillAmmo({}),1);assert.equal(activeSkillAmmo({bulletCount:2}),2);
  assert.equal(activeSkillHits({bulletCount:2},true),2);
  assert.equal(activeSkillHits({bulletCount:2,attackCount:0},true),2);
  assert.equal(activeSkillHits({bulletCount:2,attackCount:3},true),6);
  assert.equal(activeSkillHits({bulletCount:2,attackCount:20},true),15);
  assert.equal(activeSkillHits({bulletCount:2,attackCount:3}),3);
  assert.deepEqual(activeProjectileLayout(2),[{offsetY:-7,delayMs:0},{offsetY:7,delayMs:0}]);
  assert.deepEqual(activeProjectileLayout(2,true),[{offsetY:-7,delayMs:0},{offsetY:7,delayMs:120}]);
});
test('519380 compatible bows/crossbows/claws, speed and posture; no free melee or magic payload bypass',()=>{
  const a=archive(),catalog=skillCatalogOf(a),provider=basicAttackProvider(artReaderOf(a)!);
  for(const [id,weapon,ammo,hits] of [[3001004,1452000,2060000,1],[3001005,1462000,2061000,2],[4001344,1472000,2070000,2]] as const){
    const c=character(id,weapon,ammo),profile=provider(weapon)!,action=activeRangedActions(profile,id)[0]!;
    const shot:ClientAttack={skillId:id,hits,targetCount:1,speed:profile.speed,action:action.action,facingLeft:false,projectileSlot:4,
      targets:[{mobId:1,x:100,y:0,hitAnimation:0,sequence:1,damages:Array(hits).fill(10)}]};
    assert.ok(validatedActiveRanged(c,catalog,profile,shot,4));
    assert.equal(validatedBasicAttack(profile,shot,true,4),undefined);
    for(const movement of [10,11,14,16,18])assert.equal(validatedActiveRanged(c,catalog,profile,shot,movement),undefined);
    assert.equal(validatedActiveRanged(c,catalog,provider(1302000),shot,4),undefined);
    assert.equal(validatedActiveRanged(c,catalog,profile,{...shot,projectileSlot:3},4),undefined);
    assert.equal(validatedActiveRanged(c,catalog,profile,{...shot,hits:hits+1},4),undefined);
    assert.equal(validatedActiveRanged(c,catalog,profile,{...shot,skillId:2001004},4),undefined);
    assert.ok(validatedActiveRanged(c,catalog,profile,{...shot,targetCount:0,targets:[]},4));
    c.stats.mp=0;assert.equal(validatedActiveRanged(c,catalog,profile,shot,4),undefined);
  }
});
test('0x10 carries skill/hits and USE slot; 0x24 carries skill level/id, full multi-hit and original ammo ID',()=>{
  const shot:ClientAttack={skillId:4001344,hits:2,targetCount:1,speed:3,action:24,facingLeft:true,projectileSlot:4,
    targets:[{mobId:9,x:100,y:20,hitAnimation:0,sequence:1,damages:[111,222]}]};
  const bytes=encodeClientAttack(shot,0x10);
  assert.equal(bytes[0],0x10);assert.equal(bytes[1],0x12);
  assert.deepEqual(readClientAttack(new PacketReader(bytes,1),0x10),shot);
  for(let end=1;end<bytes.length;end++)assert.throws(()=>readClientAttack(new PacketReader(bytes.slice(0,end),1),0x10));
  const remote={characterId:123,hits:2,skillLevel:1,skillId:shot.skillId,facingLeft:true,action:24,speed:3,
    afterimage:0,projectileItemId:2070000,targets:[{mobId:9,hitAnimation:0,damages:[111,222]}]};
  assert.deepEqual(readUserAttack(new PacketReader(encodeUserAttack(remote,0x24),1)),remote);
});
test('Lucky Seven case47 draws LUK1.3..0.5 *5, no STR/DEX/mastery term, before level/PD/skill factor',()=>{
  const c=character(4001344,1472000,2070000),basis=statBasis(c.stats,[{slot:11,itemId:1472000,stats:{pad:50}}]);
  const totals=statTotals(basis);totals.acc=999;
  let trace:PhysicalAttackTrace|undefined,draws=0;
  const stream={values:Array(7).fill(5000000),cursor:0};
  rollNativePhysical(c,basis,totals,{level:20,eva:0,pd:20},24,3,2070000,undefined,()=>{draws++;return 1;},
    value=>{trace=value;},{skillId:4001344,damagePercent:55,random:stream});
  assert.equal(draws,0);
  assert.equal(trace!.raw,nativeUniform(5000000,100*1.3,100*0.5)*5*53*0.01);
  assert.ok(Math.abs(trace!.beforeClamp-(trace!.afterAttribute-trace!.defense)*0.55)<1e-8);
  const before=stream.cursor;
  rollNativePhysical(c,basis,totals,{level:20,eva:0,pd:20},24,3,2070000,undefined,()=>{draws++;return 1;},undefined,
    {skillId:4001344,damagePercent:55,random:stream});
  assert.equal(draws,0);assert.ok(stream.cursor>before);
});
test('real WZ custom Arrow Blow ball vs actual ammo for Double Shot/Lucky Seven, original names/counts/costs',()=>{
  const a=archive(),reader=artReaderOf(a)!,catalog=skillCatalogOf(a);
  for(const [id,mp1,damage1,mp20,damage20] of [[3001004,7,108,14,260],[3001005,8,56,16,130],[4001344,8,55,16,150]]){
    const levels=catalog.info(id!)!.levels,first=levels.find(row=>row.level===1)!.values,last=levels.find(row=>row.level===20)!.values;
    assert.deepEqual([first.mpCon,first.damage,last.mpCon,last.damage],[mp1,damage1,mp20,damage20]);
  }
  const arrow=activeArt(reader,3001004,1);
  assert.ok(arrow.balls.length>0);assert.ok(arrow.balls.every(frame=>frame.path.includes('/3001004/ball/')));
  for(const id of [3001005,4001344]){
    assert.deepEqual(activeArt(reader,id,1).balls,[]);
    assert.equal(catalog.info(id)!.levels[0]!.values.bulletCount,2);
    assert.ok(activeArt(reader,id,1).hits.length>0);
  }
});
test('0x400 is booster: real wire slot between unknown200/unknown800, not movement speed',()=>{
  const update={durationMs:1000,sourceIsSkill:true,sourceId:1101004,values:{booster:2}};
  const packet=encodeStatUpdate({ack:false,diff:{},temporary:update});
  assert.equal(packet[10],0);assert.equal(packet[11],4); // mask LE 00040000 at offset10
  assert.deepEqual(readStatUpdate(new PacketReader(packet,1)).temporary,update);
  const ledger=temporaryStats();ledger.apply({...update,values:{booster:2,pad:1}},0);
  assert.deepEqual(ledger.values(1000),{booster:2,pad:1});
  ledger.removeFields(['booster']);assert.deepEqual(ledger.values(1000),{pad:1});assert.equal(ledger.icons(1000).length,1);
  assert.deepEqual(ledger.values(1001),{});
  assert.equal(activeSkillSpeed(8,0,2),6,'subtract before clamp, never clamp raw8 to6 then subtract');
  assert.equal(activeSkillSpeed(3,4001334,2),0);
});

test('opt-in preparation is per-family, requires explicit level consent and reuses original templates',()=>{
  const catalog=itemCatalogOf(archive());
  for(const [kind,job,id,pad,minimum,ammo] of [['bow',300,1452002,25,10,2060000],['crossbow',300,1462001,29,12,2061000],['claw',400,1472000,10,10,2070000]] as const){
    const c=character(4001344,1472000,2070000);c.items!.worn.clear();c.items!.inventories[1]!.items.clear();
    c.items!.inventories[0]!.capacity=24;Object.assign(c.stats,{job,level:1,exp:3,hp:50,maxHp:50,mp:50,maxMp:50});
    const before=structuredClone(c);
    assert.throws(()=>planRangedPreparation(c,catalog,kind,false,true),/需要 Lv/);assert.deepEqual(c,before);
    const plan=planRangedPreparation(c,catalog,kind,true,true);
    assert.equal(plan.stats.level,minimum);assert.equal(plan.stats.exp,3);assert.equal(plan.stats.job,job);
    assert.equal(plan.stats.ap,c.stats.ap);assert.equal(plan.stats.sp,c.stats.sp);
    assert.deepEqual(plan.items.map32,c.items!.map32);assert.equal(plan.items.worn.size,0);assert.deepEqual(c,before);
    const weapon=[...plan.items.inventories[0]!.items.values()].find(item=>item.itemId===id)!;
    assert.equal(weapon.kind,'equip');if(weapon.kind==='equip'){assert.equal(weapon.pad,pad);assert.equal(weapon.ruc,7);}
    assert.equal(plan.stats.hp,plan.stats.maxHp);assert.equal(plan.stats.mp,plan.stats.maxMp);
    assert.equal(plan.stats.maxHp>=50+(minimum-1)*20,true);
    const charge=[...plan.items.inventories[1]!.items.values()][0]!;
    assert.equal(charge.itemId,ammo);if(charge.kind==='nonequip')assert.equal(charge.quantity,200);
    const owned={...c,stats:plan.stats,items:plan.items};
    const again=planRangedPreparation(owned,catalog,kind,false,true);assert.equal(again.raised,0);
    assert.equal(again.items.inventories[0]!.items.size,1,'do not repeatedly grant owned weapons');
    const onlyLevel=planRangedPreparation(c,catalog,kind,true,false);
    assert.equal(onlyLevel.changes.length,0);assert.deepEqual(onlyLevel.items,c.items);
    c.items!.inventories[1]!.capacity=0;const blocked=structuredClone(c);
    assert.throws(()=>planRangedPreparation(c,catalog,kind,true,true),/空間不足/);assert.deepEqual(c,blocked);
    c.stats.job=100;assert.throws(()=>planRangedPreparation(c,catalog,kind,true,true),/弓手|盜賊/);
  }
});
