import {getTimePeriod} from './environment-data.js';
import {projectMap} from './map-display.js';
import {terrainMaximumHeight} from './terrain-data.js';
import {terrainRenderWindow} from './terrain-render-grid.js';
const NS='http://www.w3.org/2000/svg';
function node(tag,attrs,parent){const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);parent.append(e);return e}
const point=p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`;
export function sceneLighting(time){
 const period=getTimePeriod(time);
 return {period:period.id,label:period.label,...{
  day:{exposure:1.16,accent:null,direction:null},
  night:{exposure:0.56,accent:'#35538b',direction:null},
  dawn:{exposure:0.84,accent:'#ec9b86',direction:'east'},
  dusk:{exposure:0.82,accent:'#e88a70',direction:'west'}
 }[period.id]};
}
export function applySceneLighting(panel,layer,terrain,time){
 const lighting=sceneLighting(time);
 panel.dataset.period=lighting.period;
 panel.style.setProperty('--terrain-exposure',String(lighting.exposure));
 layer.replaceChildren();
 if(!lighting.accent)return lighting;
 const corners=[[-terrain.width/2,-terrain.height/2],[terrain.width/2,-terrain.height/2],[terrain.width/2,terrain.height/2],[-terrain.width/2,terrain.height/2]].map(([x,y])=>projectMap(x,y,0));
 const defs=node('defs',{},layer);
 const anchor=projectMap(lighting.direction==='east'?terrain.width/2:lighting.direction==='west'?-terrain.width/2:0,0,0);
 const gradient=node('radialGradient',{id:'scene-horizon-wash',gradientUnits:'userSpaceOnUse',cx:anchor.x,cy:anchor.y,r:Math.max(terrain.width,terrain.height)*1.1},defs);
 node('stop',{offset:'0%','stop-color':lighting.accent,'stop-opacity':lighting.direction?'.27':'.10'},gradient);
 node('stop',{offset:'75%','stop-color':lighting.accent,'stop-opacity':'0'},gradient);
 node('polygon',{points:corners.map(point).join(' '),fill:'url(#scene-horizon-wash)'},layer);
 return lighting;
}
function niceStep(value){const values=[1,2,5,10,25,50,100,250,500,1000,2500,5000,10000];return values.find(n=>n>=value)??10000}
export function distanceGridSettings(terrain,view,box,requested='auto'){
 const window=terrainRenderWindow(terrain,view,box);
 if(!window.cols.length)return {step:1,x0:0,x1:-1,y0:0,y1:-1,zStep:1,zMax:0};
 const x0=-terrain.width/2+window.cols[0]*terrain.width/(terrain.cols-1),x1=-terrain.width/2+window.cols.at(-1)*terrain.width/(terrain.cols-1);
 const y0=-terrain.height/2+window.rows[0]*terrain.height/(terrain.rows-1),y1=-terrain.height/2+window.rows.at(-1)*terrain.height/(terrain.rows-1);
 const minimum=Math.max(1,((x1-x0)+(y1-y0))/240);
 const selected=requested==='auto'?35/Math.max(view.scale,0.001):Number(requested);
 const zMax=Math.max(10,Math.ceil(terrainMaximumHeight(terrain)/10)*10);
 return {step:niceStep(Math.max(minimum,Number.isFinite(selected)&&selected>0?selected:5)),x0,x1,y0,y1,zStep:niceStep(zMax/8),zMax};
}
export function drawDistanceGrid(layer,terrain,{visible,view,box,requested='auto',planes='xy'}){
 layer.replaceChildren();if(!visible)return null;
 const s=distanceGridSettings(terrain,view,box,requested);
 if(s.x0>s.x1||s.y0>s.y1)return s;
 const lines=[];
 const line=(a,b)=>lines.push(`M${point(projectMap(...a))}L${point(projectMap(...b))}`);
 for(let x=Math.ceil(s.x0/s.step)*s.step;x<=s.x1;x+=s.step)line([x,s.y0,0],[x,s.y1,0]);
 for(let y=Math.ceil(s.y0/s.step)*s.step;y<=s.y1;y+=s.step)line([s.x0,y,0],[s.x1,y,0]);
 node('path',{d:lines.join(''),class:'distance-grid-floor',fill:'none'},layer);
 if(planes==='xyz'){
  const vertical=[];const add=(a,b)=>vertical.push(`M${point(projectMap(...a))}L${point(projectMap(...b))}`);
  for(let z=s.zStep;z<=s.zMax;z+=s.zStep){add([s.x0,0,z],[s.x1,0,z]);add([0,s.y0,z],[0,s.y1,z])}
  for(let x=Math.ceil(s.x0/s.step)*s.step;x<=s.x1;x+=s.step)add([x,0,0],[x,0,s.zMax]);
  for(let y=Math.ceil(s.y0/s.step)*s.step;y<=s.y1;y+=s.step)add([0,y,0],[0,y,s.zMax]);
  node('path',{d:vertical.join(''),class:'distance-grid-vertical',fill:'none'},layer);
 }
 // Coordinate values at a sparse subset of intersections, independent of display terrain LOD.
 const labelEvery=s.step*5;
 for(let x=Math.ceil(s.x0/labelEvery)*labelEvery;x<=s.x1;x+=labelEvery){const p=projectMap(x,s.y1,0);node('text',{x:p.x,y:p.y+13,class:'distance-grid-label'},layer).textContent=String(x)}
 for(let y=Math.ceil(s.y0/labelEvery)*labelEvery;y<=s.y1;y+=labelEvery){const p=projectMap(s.x1,y,0);node('text',{x:p.x+5,y:p.y,class:'distance-grid-label'},layer).textContent=String(y)}
 return s;
}
