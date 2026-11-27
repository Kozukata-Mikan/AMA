import {supportGroups} from './electronic-warfare.js?v=visual-support-bridge-1';
import {sampleTerrain} from './terrain-data.js';
import {buildingAlive} from './building-state.js?v=visual-support-bridge-1';
const EPS=1e-7,SMOKE_RADIUS=.5;
const smokeIndexes=new WeakMap();
const fail=m=>{throw Error(m);};
export const visualSupportActive=u=>u&&!u.projectileState&&Number.isFinite(u.x)&&Number.isFinite(u.y)&&(u.branch==='building'?buildingAlive(u):u.branch==='air'?u.aircraftState?.mission==='airborne'&&u.aircraftState.status==='operational':u.branch==='navy'&&!['sinking','sunk'].includes(u.shipState?.status));
export const visualSupportTarget=u=>u&&Number.isFinite(u.x)&&Number.isFinite(u.y)&&(u.projectileState?u.projectileState.status==='flying':u.branch==='building'?u.currentHp>0:u.branch==='air'?['airborne','landing'].includes(u.aircraftState?.mission)&&u.aircraftState.status!=='destroyed':u.branch==='navy'?u.shipState?.status!=='sunk':u.currentHp>0);
export function initializeVisualSupport(scene){
 scene.visualSupportRuntime??={version:1,smokes:[],lights:[],records:[]};const r=scene.visualSupportRuntime,ids=new Set(scene.instances.map(u=>u.instanceId));
 if(r.version!==1||![r.smokes,r.lights,r.records].every(Array.isArray))fail('煙幕・探照灯の保存形式が不正です。');
 const keys=new Set();for(const smoke of r.smokes){if(typeof smoke.id!=='string'||keys.has(smoke.id)||!ids.has(smoke.unitId)||!Number.isSafeInteger(smoke.createdTurn)||smoke.createdTurn<1||smoke.createdTurn>scene.turn.number||!Array.isArray(smoke.route)||!smoke.route.length||smoke.route.some(p=>![p.x,p.y].every(Number.isFinite)))fail('煙幕の保存状態が不正です。');keys.add(smoke.id);}
 const groups=new Set();for(const light of r.lights){const key=JSON.stringify([light.unitId,light.groupId]);if(groups.has(key)||!ids.has(light.unitId)||!ids.has(light.targetId)||typeof light.groupId!=='string'||light.unitId===light.targetId)fail('探照灯の保存状態が不正です。');groups.add(key);}
 for(const u of scene.instances)if(u.visualSupport&&((u.visualSupport.smokeEnabled!==undefined&&typeof u.visualSupport.smokeEnabled!=='boolean')||(u.visualSupport.lastSmokeTurn!==undefined&&(!Number.isSafeInteger(u.visualSupport.lastSmokeTurn)||u.visualSupport.lastSmokeTurn<1||u.visualSupport.lastSmokeTurn>scene.turn.number))))fail('発煙筒の使用履歴が不正です。');
 return r;
}
export function reconcileVisualSupport(scene){
 const r=initializeVisualSupport(scene),units=new Map(scene.instances.map(u=>[u.instanceId,u]));
 r.lights=r.lights.filter(l=>{const a=units.get(l.unitId),b=units.get(l.targetId);return visualSupportActive(a)&&visualSupportTarget(b)&&Math.hypot(a.x-b.x,a.y-b.y)<=100+EPS&&supportGroups(a,'searchlight').some(g=>g.id===l.groupId);});
 const illuminated=new Set(r.lights.flatMap(l=>[l.unitId,l.targetId]));for(const u of scene.instances){if(illuminated.has(u.instanceId))u.searchlightIlluminated=true;else delete u.searchlightIlluminated;}
 return r;
}
function emitSmoke(scene,u){
 if(!visualSupportActive(u)||u.visualSupport?.lastSmokeTurn===scene.turn.number)return false;
 const group=supportGroups(u,'smoke-generator')[0];if(!group)return false;
 scene.visualSupportRuntime.revision=(scene.visualSupportRuntime.revision??0)+1;group.consumed=true;u.visualSupport??={};u.visualSupport.lastSmokeTurn=scene.turn.number;
 const smoke={id:crypto.randomUUID(),unitId:u.instanceId,side:u.side,groupId:group.id,createdTurn:scene.turn.number,route:[{x:u.x,y:u.y}]};scene.visualSupportRuntime.smokes.push(smoke);scene.visualSupportRuntime.records.push({kind:'smoke',unitId:u.instanceId,side:u.side,turnNumber:scene.turn.number,groupId:group.id});return true;
}
export function setSmoke(scene,{unitId,enabled}){
 initializeVisualSupport(scene);if(scene.turn.phaseId!=='special'||typeof enabled!=='boolean')fail('発煙筒は特殊段階で設定してください。');const u=scene.instances.find(u=>u.instanceId===unitId);if(!visualSupportActive(u))fail('行動可能な発煙ユニットを選択してください。');
 if(enabled&&u.visualSupport?.lastSmokeTurn!==scene.turn.number&&!supportGroups(u,'smoke-generator').length)fail('未使用の発煙筒がありません。');u.visualSupport??={};u.visualSupport.smokeEnabled=enabled;if(enabled)emitSmoke(scene,u);
}
export function setSearchlight(scene,{unitId,groupId,targetId},identifiedIds){
 const r=initializeVisualSupport(scene);if(!['start','special'].includes(scene.turn.phaseId))fail('探照灯は開始・特殊段階で設定してください。');const u=scene.instances.find(u=>u.instanceId===unitId);if(!visualSupportActive(u)||!supportGroups(u,'searchlight').some(g=>g.id===groupId))fail('使用可能な探照灯を選択してください。');
 if(targetId!==null){const target=scene.instances.find(u=>u.instanceId===targetId);if(!visualSupportTarget(target)||target===u||!identifiedIds.has(targetId))fail('識別済みの目標を選択してください。');if(Math.hypot(u.x-target.x,u.y-target.y)>100+EPS)fail('探照灯の照射距離は100マス以内です。');}
 r.lights=r.lights.filter(l=>l.unitId!==unitId||l.groupId!==groupId);if(targetId!==null)r.lights.push({unitId,groupId,targetId});reconcileVisualSupport(scene);
}
export function resolveVisualSupportSpecial(scene){const r=initializeVisualSupport(scene);r.revision=(r.revision??0)+1;r.smokes=r.smokes.filter(s=>s.createdTurn>=scene.turn.number);for(const u of scene.instances)if(u.visualSupport?.smokeEnabled)emitSmoke(scene,u);reconcileVisualSupport(scene);}
export function extendSmokeRoutes(scene,destinations){const r=initializeVisualSupport(scene);r.revision=(r.revision??0)+1;const moves=new Map(destinations.map(d=>[d.instanceId,d.route]));for(const smoke of r.smokes){if(smoke.createdTurn!==scene.turn.number-1||smoke.movedTurn===scene.turn.number)continue;const route=moves.get(smoke.unitId);if(route?.length)smoke.route=[...smoke.route,...route.filter((p,i)=>i>0||Math.hypot(p.x-smoke.route[0].x,p.y-smoke.route[0].y)>EPS)].map(p=>({x:p.x,y:p.y}));smoke.movedTurn=scene.turn.number;}reconcileVisualSupport(scene);}
// Exact segment/capsule overlap. No grid sampling, including short diagonal crossings.
function clipLinear(interval,origin,delta,low,high){if(Math.abs(delta)<EPS)return origin<low-EPS||origin>high+EPS?null:interval;let a=(low-origin)/delta,b=(high-origin)/delta;if(a>b)[a,b]=[b,a];const out=[Math.max(interval[0],a),Math.min(interval[1],b)];return out[0]<=out[1]+EPS?out:null;}
function circleInterval(from,to,center,radius=SMOKE_RADIUS){const dx=to.x-from.x,dy=to.y-from.y,fx=from.x-center.x,fy=from.y-center.y,A=dx*dx+dy*dy,C=fx*fx+fy*fy-radius**2;if(A<EPS)return C<=EPS?[0,1]:null;const B=2*(fx*dx+fy*dy),disc=B*B-4*A*C;if(disc<-EPS)return null;const root=Math.sqrt(Math.max(0,disc)),a=Math.max(0,(-B-root)/(2*A)),b=Math.min(1,(-B+root)/(2*A));return a<=b+EPS?[a,b]:null;}
function capsuleIntervals(from,to,a,b){const result=[circleInterval(from,to,a),circleInterval(from,to,b)].filter(Boolean),length=Math.hypot(b.x-a.x,b.y-a.y);if(length<EPS)return result;const ux=(b.x-a.x)/length,uy=(b.y-a.y)/length,dx=to.x-from.x,dy=to.y-from.y,fx=from.x-a.x,fy=from.y-a.y;let interval=clipLinear([0,1],fx*ux+fy*uy,dx*ux+dy*uy,0,length);if(interval)interval=clipLinear(interval,-fx*uy+fy*ux,-dx*uy+dy*ux,-SMOKE_RADIUS,SMOKE_RADIUS);if(interval)result.push(interval);return result;}
function visitPathCells(a,b,visit){const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/32));for(let i=0;i<=n;i++){const x=Math.floor((a.x+(b.x-a.x)*i/n)/64),y=Math.floor((a.y+(b.y-a.y)*i/n)/64);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)visit(`${x+dx},${y+dy}`);}}
function smokeCandidates(runtime,from,to){let index=smokeIndexes.get(runtime);if(!index||index.revision!==(runtime.revision??0)){index={revision:runtime.revision??0,buckets:new Map()};for(const smoke of runtime.smokes)for(let i=0;i<smoke.route.length;i++){const segment=[smoke.route[i],smoke.route[i+1]??smoke.route[i]];visitPathCells(...segment,key=>{if(!index.buckets.has(key))index.buckets.set(key,new Set());index.buckets.get(key).add(segment);});}smokeIndexes.set(runtime,index);}const candidates=new Set();visitPathCells(from,to,key=>{for(const segment of index.buckets.get(key)??[])candidates.add(segment);});return candidates;}
export function smokeBlocks(scene,from,to,fromHeight,toHeight,terrainCuts){
 const smokes=scene.visualSupportRuntime?.smokes;if(!smokes?.length||Math.max(fromHeight,toHeight)<-EPS)return false;
 let breaks;for(const segment of smokeCandidates(scene.visualSupportRuntime,from,to))for(const interval of capsuleIntervals(from,to,...segment)){
  const [lo,hi]=interval;if(lo>1||hi<0)continue;breaks??=terrainCuts(scene.terrain,from,to);const cuts=[lo,...breaks.filter(t=>t>lo+EPS&&t<hi-EPS),hi];
  for(let n=cuts.length-2;n>=0;n--){const a=cuts[n],b=cuts[n+1],height=t=>sampleTerrain(scene.terrain,from.x+(to.x-from.x)*t,from.y+(to.y-from.y)*t).height,ha=height(a),hb=height(b);if(ha*hb<0)cuts.splice(n+1,0,a+(b-a)*(-ha)/(hb-ha));}
  for(let n=0;n<cuts.length;n++){const a=cuts[n],b=cuts[n+1]??a,relative=t=>fromHeight+(toHeight-fromHeight)*t-sampleTerrain(scene.terrain,from.x+(to.x-from.x)*t,from.y+(to.y-from.y)*t).surface;const z1=relative(a),z2=relative(b);if(Math.min(z1,z2)<=10+EPS&&Math.max(z1,z2)>=-EPS)return true;}
 }return false;
}
export function observedVisualSupport(scene,side,identified,observers=[],range=100,canSee=()=>true){
 const r=scene.visualSupportRuntime,smokes=[];
 for(const smoke of r?.smokes??[]){if(smoke.side===side){smokes.push({id:smoke.id,route:smoke.route});continue;}
  for(let i=0;i<smoke.route.length;i++){const a=smoke.route[i],b=smoke.route[i+1]??a,at=t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}),intervals=[];
   for(const observer of observers){const interval=circleInterval(a,b,observer,range);if(interval&&canSee(observer,at((interval[0]+interval[1])/2)))intervals.push(interval);}
   intervals.sort((a,b)=>a[0]-b[0]);const merged=[];for(const interval of intervals){const previous=merged.at(-1);if(previous&&interval[0]<=previous[1]+EPS)previous[1]=Math.max(previous[1],interval[1]);else merged.push([...interval]);}
   for(const [n,interval]of merged.entries())smokes.push({id:`${smoke.id}:${i}:${n}`,route:[at(interval[0]),at(interval[1])]});
  }
 }
 return{version:1,smokes,lights:(r?.lights??[]).filter(l=>identified.has(l.unitId)&&identified.has(l.targetId)).map(l=>({unitId:l.unitId,targetId:l.targetId})),ownLights:(r?.lights??[]).filter(l=>scene.instances.find(u=>u.instanceId===l.unitId)?.side===side).map(l=>({...l}))};
}
