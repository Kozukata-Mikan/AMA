import test from 'node:test';
import assert from 'node:assert/strict';
import {runCarrierAirStrike} from '../scripts/run-carrier-air-strike.mjs';

test('seeded airport A/B/C strike versus carrier fleet and D CAP completes combat, AA disruption, return and landing',async()=>{
 const r=await runCarrierAirStrike();
 assert.equal(r.summary.ships.find(s=>s.name==='敵空母').hp,67);
 assert.deepEqual(r.summary.squadrons.map(s=>[s.name,s.destroyed,s.parked]),[['A隊',1,5],['B隊',1,11],['C隊',0,6],['D隊',3,3]]);
 assert.equal(r.final.aviationRuntime.records.filter(r=>r.kind==='navigation-loss'&&r.crashed).length,3);
 assert.ok(r.final.aviationRuntime.records.some(r=>r.kind==='forced-landing'&&r.success&&r.rolls[0]===false&&r.rolls[1]===true));
 assert.equal(r.summary.rounds,4);assert.equal(r.summary.airCombats,5);assert.equal(r.summary.duels,22);
 const flak=r.summary.disruption.filter(d=>d.turnNumber===2&&d.phaseId==='order-4');
 assert.deepEqual(flak.map(d=>[d.projection,d.aircraftCount,d.addedPenalties]),[[120,12,1],[60,6,1]]);
 const B=r.logs.find(e=>e.event==='attack-phase'&&e.round===2&&e.phaseId==='order-3');
 const C=r.logs.find(e=>e.event==='attack-phase'&&e.round===2&&e.phaseId==='order-2');
 assert.ok(B.record.hitReports.some(h=>h.unitId.startsWith('味方飛行場:air:1:')&&h.modifiers.airDisruption===1));
 assert.ok(C.record.hitReports.some(h=>h.unitId.startsWith('味方飛行場:air:2:')&&h.modifiers.airDisruption===1));
 assert.ok(r.logs.some(e=>e.airCombat?.some(c=>c.duels.some(d=>d.panic?.some(p=>p.state==='retreating')))));
 assert.equal(r.final.instances.filter(u=>u.branch==='air'&&u.side==='ally'&&u.aircraftState.status!=='destroyed').length,22);
 assert.ok(r.final.instances.filter(u=>u.branch==='air'&&u.side==='ally'&&u.aircraftState.status!=='destroyed').every(p=>p.aircraftState.mission==='parked'&&!p.aircraftState.panic));
});
