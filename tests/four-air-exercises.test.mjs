import test from 'node:test';
import assert from 'node:assert/strict';
import {runAirExercise} from '../scripts/run-four-air-exercises.mjs';
const attacks=r=>r.logs.filter(l=>l.event==='attack');
const duels=r=>attacks(r).flatMap(l=>l.airCombat.flatMap(c=>c.duels));
test('carrier three-squadron strike fights airport CAP and surviving heavy martyr planes ram with selected payload',async()=>{
 const r=await runAirExercise(1);assert.equal(r.summary.squadrons.length,4);assert.ok(r.summary.airBattles>0);assert.equal(r.summary.rams.length,2);
 assert.ok(r.summary.rams.every(x=>x.targetId==='敵飛行場'&&x.detonation.hpDamage===2&&x.detonation.aircraftIds.length===1));
 for(const x of r.summary.rams){const p=r.final.instances.find(p=>p.instanceId===x.aircraftId);assert.equal(p.aircraftState.destroyedReason,'martyr-ram');}
 assert.ok(r.summary.targets.find(t=>t.id==='敵飛行場').hp<240);assert.equal(r.summary.squadrons.filter(x=>x.name!=='D防衛隊').reduce((n,x)=>n+x.parked,0),19);
});
test('CAS submarine strike filters ordinary fixed weapons without blocking the round, low cloud conceals and eloquence aims',async()=>{
 const r=await runAirExercise(2);assert.ok(r.summary.targets.find(t=>t.id==='敵潜水艦').hp<120);
 assert.ok(r.summary.hits.length>0);assert.ok(r.summary.hits.every(h=>h.targetId==='敵潜水艦'&&r.final.instances.find(p=>p.instanceId===h.unitId).equipmentState.groups.find(g=>g.id===h.groupId).position==='掛載'));
 const aimed=r.summary.damage.flatMap(d=>d.cannonImpacts??[]).filter(i=>i.impact.position.aimed);assert.ok(aimed.length>0);assert.ok(aimed.every(i=>i.impact.position.id==='middle-1'&&!i.impact.position.overpenetration));
 const low=r.logs.find(l=>l.event==='low-cloud-recon');assert.equal(low.relativeHeight,1);assert.equal(low.at150,null);assert.equal(low.at100,'identified');assert.ok(r.summary.squadrons.every(x=>x.parked===6));
});
test('aircraft really discover an initially unseen submarine on CAR then manually attack and return',async()=>{
 const r=await runAirExercise(2,{searchFirst:true});assert.ok(!r.logs.find(l=>l.event==='initial-visibility').visibility.some(([id])=>id==='敵潜水艦'));
 assert.ok(r.logs.find(l=>l.event==='movement'&&l.round===2).visibility.some(([id,level])=>id==='敵潜水艦'&&level==='identified'));assert.ok(r.summary.hits.length>0);assert.ok(r.summary.targets.find(t=>t.id==='敵潜水艦').hp<120);assert.ok(r.summary.squadrons.every(x=>x.parked===6));
});
test('eight all-weather squadrons fly across midnight, ambush once per round, suppress panic and inherit a fallen ACE',async()=>{
 const r=await runAirExercise(3,{seed:20261126});assert.equal(r.summary.squadrons.length,8);assert.equal(r.logs.find(l=>l.event==='night-limit-control').accepted,false);assert.deepEqual(r.summary.end,{day:2,time:'02:30',weather:'clear'});assert.ok(r.summary.ambushes>0);
 assert.ok(r.summary.panic.some(p=>p.immune));assert.ok(r.summary.panic.filter(p=>p.immune).every(p=>p.state==='normal'));assert.ok(r.summary.panic.some(p=>!p.immune&&p.state!=='normal'));
 const keys=new Set();for(const a of attacks(r))for(const d of a.airCombat.flatMap(c=>c.duels))for(const ambush of d.ambush??[]){const ids=ambush.shots.map(s=>s.actorId),team=r.final.instances.find(p=>p.instanceId===ids[0]).aircraftState.trainingTeamId,key=`${a.round}:${team}`;assert.ok(!keys.has(key));keys.add(key);}
 const losses=[...duels(r).flatMap(d=>d.aceLosses??[]),...r.final.aviationRuntime.records.filter(x=>x.kind==='ace-loss')];const success=losses.find(x=>x.success);assert.ok(success);assert.deepEqual(success.rolls,[true,true]);const heir=r.final.instances.find(p=>p.instanceId===success.heirId);assert.equal(heir.aircraftState.effectiveTraining,'ace');assert.equal(heir.aircraftState.acePilot,true);assert.ok(r.summary.squadrons.every(x=>x.parked+x.destroyed===x.total));
});
test('three economy squadrons distribute each salvo over all eight known ships and land intact',async()=>{
 const r=await runAirExercise(4);const primary=attacks(r).find(a=>a.round===2&&a.phase==='order-5');const counts=new Map();for(const h of primary.record.hitReports)counts.set(h.targetId,(counts.get(h.targetId)??0)+1);assert.equal(counts.size,8);assert.ok(Math.max(...counts.values())-Math.min(...counts.values())<=1);
 assert.ok(r.summary.squadrons.every(x=>x.destroyed===0&&x.parked===9));assert.equal(r.summary.targets.filter(t=>t.id!=='味方飛行場').length,8);
});
