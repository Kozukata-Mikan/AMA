import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBroadsideQuotas,assertPlannedBroadsideQuotas} from '../tactical-map/weapon-firing-arc.js?v=settlement-audit-1';
const modes=['left','right','all','random1','random2'];
const permitted=f=>{try{f();return true;}catch(e){if(e.code==='BROADSIDE_QUOTA')return false;throw e;}};
function fixture(total,types,history=false){
 const groups=Array.from({length:total},(_,i)=>({id:'g'+i,mountIndex:0,position:'両舷'}));const actor={instanceId:'a',branch:'navy',x:0,y:0,heading:0,equipmentState:{groups}};
 const start={turn:{number:1},instances:[actor,{instanceId:'L',x:-10,y:0},{instanceId:'R',x:10,y:0}]};
 const records=history?[{turnNumber:1,resourceReports:[{unitId:'a',groupId:'g0',firingSides:['left']}]}]:[];
 const entries=types.map((t,i)=>({commandId:'c'+i,unitId:'a',groupId:'g'+(i+Number(history)),targetId:t==='right'?'R':'L'}));
 const checks=types.map((t,i)=>['left','right'].includes(t)?{kind:'single'}:{kind:'range',range:{scope:{mode:t==='all'?'all':'random',maximumTargets:t==='random1'?1:t==='random2'?2:null},eligibleIds:['L','R'],specifiedTargetIds:[]}});
 const choices=types.map(t=>t==='left'?[['L']]:t==='right'?[['R']]:t==='all'?[['L','R']]:t==='random1'?[['L'],['R']]:[['L'],['R'],['L','R']]);return{start,records,entries,checks,choices};
}
test('range quota preflight exactly matches every actual draw for small even and odd mounts, including prior fire',()=>{
 let verified=0;
 for(let total=1;total<=4;total++)for(const history of [false,true]){
  const count=total-Number(history),all=[];
  function configs(a){if(a.length===count){all.push(a);return;}for(const m of modes)configs([...a,m]);}configs([]);
  for(const types of all){const f=fixture(total,types,history);let oracle=true;
   function draws(index,assignments){if(!oracle)return;if(index===count){oracle=permitted(()=>assertBroadsideQuotas(f.start,f.entries,assignments,f.records));return;}for(const ids of f.choices[index])draws(index+1,[...assignments,{commandId:f.entries[index].commandId,targetIds:ids}]);}
   draws(0,[]);assert.equal(permitted(()=>assertPlannedBroadsideQuotas(f.start,f.entries,f.checks,f.records)),oracle,JSON.stringify({total,types,history}));verified++;
  }
 }
 assert.equal(verified,936);
});
