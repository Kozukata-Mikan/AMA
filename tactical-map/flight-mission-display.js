export function drawFlightMissions(parent,scene,project){
 const ns='http://www.w3.org/2000/svg',layer=document.createElementNS(ns,'g'),seen=new Set();layer.setAttribute('class','flight-mission-overlay');layer.setAttribute('pointer-events','none');parent.append(layer);
 const units=new Map(scene.instances.map(u=>[u.instanceId,u]));
 for(const p of scene.instances){const f=p.aircraftState?.flightPlan;if(!p.observationOwn||!f||f.stage==='complete')continue;const key=JSON.stringify([p.aircraftState.clusterId??p.instanceId,f.kind,f.stage,f.origin,f.waypoints,f.targetId,f.escortId,f.radius]);if(seen.has(key))continue;seen.add(key);let points;
  if(f.stage==='returning'){const home=units.get(f.homeId);points=home?[p,home]:[p];}
  else if(f.kind==='CAP')points=Array.from({length:73},(_,i)=>({x:f.origin.x+Math.cos(i*Math.PI/36)*f.radius,y:f.origin.y+Math.sin(i*Math.PI/36)*f.radius}));
  else if(f.behavior==='escort'){const protectedPlane=units.get(f.escortId);points=protectedPlane?[p,protectedPlane]:[p];}
  else points=[p,...f.waypoints.slice(f.cursor),...(f.kind==='CAS'&&f.targetPoint?[f.targetPoint]:[])];
  const line=document.createElementNS(ns,'polyline');line.setAttribute('points',points.map(w=>{const q=project(w.x,w.y,f.altitude);return`${q.x},${q.y}`;}).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke',({CAR:'#69e4c3',CAS:'#ffc56e',CAP:'#c597ff'})[f.kind]);line.setAttribute('stroke-width','2');line.setAttribute('stroke-dasharray',f.stage==='returning'?'3 5':'9 4');line.setAttribute('vector-effect','non-scaling-stroke');const title=document.createElementNS(ns,'title');title.textContent=`${p.name} / ${f.kind} / ${f.stage==='returning'?'帰投':'航路'}`;line.append(title);layer.append(line);
  for(const w of points.slice(1)){if(f.kind==='CAP')break;const q=project(w.x,w.y,f.altitude),dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',q.x);dot.setAttribute('cy',q.y);dot.setAttribute('r','3');dot.setAttribute('fill',line.getAttribute('stroke'));layer.append(dot);}
 }
 return layer;
}
