import {getGuidanceKind,getGuidanceLabel} from './weapon-profile-runtime.js?v=electronic-ballistic-1';
import {AIRCRAFT_TYPES} from '../js/aircraft-template.js?v=self-sealing-1';
const shape=d=>({tag:'path',d,fill:'currentColor',stroke:'none'});
const line=d=>({tag:'path',d,fill:'none',stroke:'currentColor','stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round'});
const PLANE='M0 -30 L6 -7 L26 7 L26 13 L5 6 L4 19 L12 24 L12 28 L0 24 L-12 28 L-12 24 L-4 19 L-5 6 L-26 13 L-26 7 L-6 -7 Z';
const DRONE='M0 -29 L7 -10 L27 13 L24 18 L5 10 L4 23 L0 26 L-4 23 L-5 10 L-24 18 L-27 13 L-7 -10 Z';
const RUNWAY=line('M-24 33 H24 M-17 30 V36 M17 30 V36');
const RADIO=line('M16 -26 Q25 -33 34 -26 M20 -21 Q25 -25 30 -21 M25 -16 h.1');
const WEAPONS={
 lobbed:[shape('M-28 20 L-22 8 L18 -24 L25 -16 L-12 14 L-8 25 L-28 25 Z')],
 direct:[shape('M-28 9 L-21 -4 L28 -4 L28 5 L-10 5 L-6 24 L-28 24 Z')],
 inertial:[shape('M-5 -19 L-13 -27 L-13 -13 L-7 -9 L-7 12 Q-7 23 0 29 Q7 23 7 12 L7 -9 L13 -13 L13 -27 L5 -19 Z')],
 ray:[line('M-25 -27 L22 22 M-29 -18 L10 21 M-16 -30 L23 9 M15 25 L27 25 L27 13'),shape('M27 27 L13 22 L22 13 Z')],
 radar:[line('M0 -28 A28 28 0 1 1 -28 0 M0 -18 A18 18 0 1 1 -18 0 M0 0 L20 -20 M-28 0 H28 M0 0 V28'),shape('M-3 -3 H3 V3 H-3 Z')],
 computer:[line('M-5 -28 A23 23 0 1 0 18 -5 M-5 -17 A12 12 0 1 0 7 -5 M-5 -5 L9 -19 M-23 -5 H-5 V15 M6 8 Q19 -5 32 8 M11 14 Q19 6 27 14 M16 20 Q19 17 22 20'),shape('M17 25 H21 V29 H17 Z')]
};
/** Catalog-only vector symbols. Never infer weapon rules from the appearance. */
export function catalogSymbol(item){
 if(item.branch==='air'){
  const type=item.aircraft?.type??'carrier',parts=[shape(type==='drone'||type==='land-drone'?DRONE:PLANE)];
  if(type==='carrier')parts.push(line('M17 18 V29 Q17 35 24 35 Q31 35 31 28 M13 22 H21'));
  if(type==='land'||type==='land-drone')parts.push(RUNWAY);
  if(type==='seaplane')parts.push(shape('M-17 12 H-11 V25 Q-14 30 -17 25 Z M11 12 H17 V25 Q14 30 11 25 Z'),line('M-27 33 Q-20 28 -13 33 T1 33 T15 33 T29 33'));
  if(type==='drone'||type==='land-drone')parts.push(RADIO);
  return{label:AIRCRAFT_TYPES.find(([id])=>id===type)?.[1]??'航空機',parts};
 }
 if(item.kind==='weapon'){
  const guidance=getGuidanceKind(item.guidance),parts=[...(WEAPONS[guidance?.id]??[line('M-18 -18 L18 18 M18 -18 L-18 18')])];
  if(guidance?.large){parts.splice(0,parts.length,shape('M-13 -20 L-21 -30 L-21 -11 L-13 -5 L-13 11 Q-13 25 0 32 Q13 25 13 11 L13 -5 L21 -11 L21 -30 L13 -20 Z'),{...line('M14 1 L28 -24 L39 1 Z M28 -16 V-8 M28 -3 h.1'),'stroke-width':2.5});}
  if(guidance?.underwater){parts.unshift(line('M-32 -32 Q-24 -37 -16 -32 T0 -32 T16 -32 T32 -32'));parts.push(line('M-25 29 Q-17 24 -9 29 T7 29 T23 29'));}
  return{label:getGuidanceLabel(item.guidance)||'引導方式未設定',parts};
 }
 return null;
}
export function drawCatalogSymbol(svg,item){const symbol=catalogSymbol(item);if(!symbol)return false;svg.setAttribute('data-catalog-symbol',item.branch==='air'?item.aircraft?.type??'carrier':item.guidance??'unknown');const title=document.createElementNS(svg.namespaceURI,'title');title.textContent=symbol.label;svg.append(title);for(const {tag,...attrs}of symbol.parts){const n=document.createElementNS(svg.namespaceURI,tag);n.setAttribute('style','vector-effect:none');for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);svg.append(n);}return true;}
