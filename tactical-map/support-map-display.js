import {supportCapacity,supportRadius} from './support-equipment.js?v=air-combat-1';
import {sampleTerrain} from './terrain-data.js';
export function drawSupportOverlay(parent,scene,project,highlightId=''){
 const ns='http://www.w3.org/2000/svg',layer=document.createElementNS(ns,'g');layer.setAttribute('class','support-overlay');layer.setAttribute('pointer-events','none');parent.append(layer);
 const add=(tag,attrs)=>{const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);layer.append(n);return n;};
 const active=(scene.supportRuntime?.tasks??[]).filter(t=>t.status==='active'),participants=new Set(active.map(t=>t.providerId));
 const point=u=>project(u.x,u.y,sampleTerrain(scene.terrain,u.x,u.y).surface);
 for(const unit of scene.instances){
  if(unit.x==null||unit.y==null||unit.branch==='building'||unit.observationLevel==='shadow')continue;
  if(unit.instanceId!==highlightId&&!participants.has(unit.instanceId)&&!['repair-station','damage-control-station','supply-station'].some(role=>supportCapacity(unit,role)>0))continue;
  const radius=supportRadius(unit),z=sampleTerrain(scene.terrain,unit.x,unit.y).surface;
  const pts=Array.from({length:64},(_,i)=>{const a=i*Math.PI/32,p=project(unit.x+Math.cos(a)*radius,unit.y+Math.sin(a)*radius,z);return `${p.x},${p.y}`;}).join(' ');
  add('polygon',{points:pts,class:'unit-support-circle',fill:'none',stroke:unit.side==='enemy'?'#ff8d68':'#75cfff','stroke-width':'1.3','stroke-dasharray':'4 3','vector-effect':'non-scaling-stroke'});
 }
 const links=[...active,...(scene.rescueTasks??[]).filter(t=>t.status==='active').map(t=>({...t,providerId:t.rescuerId}))];
 for(const task of links){const a=scene.instances.find(u=>u.instanceId===task.providerId),b=scene.instances.find(u=>u.instanceId===task.targetId);if(!a||!b||a.observationLevel==='shadow'||b.observationLevel==='shadow')continue;const p=point(a),q=point(b),x=(p.x+q.x)/2,y=(p.y+q.y)/2;add('line',{x1:p.x,y1:p.y,x2:q.x,y2:q.y,stroke:'#a6d8ca','stroke-width':'1','stroke-dasharray':'3 3','vector-effect':'non-scaling-stroke'});add('circle',{cx:x,cy:y,r:9,fill:'#102a35',stroke:'#a6d8ca','stroke-width':'1'});const logo=add('text',{x,y:y+4,'text-anchor':'middle','font-size':'13',class:'support-handshake',role:'img','aria-label':'支援中'});logo.textContent='🤝';}
}
