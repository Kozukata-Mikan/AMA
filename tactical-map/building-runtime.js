// 建筑只接入资料、部署、侦察与显示；不套用舰船的航行和损管规则。
export const BUILDING_KINDS = [['airport','飛行場'],['port','港湾']];
export const AIRPORT_DURABILITY = [['temporary','臨時飛行場'],['permanent','恒久飛行場']];
export const AIRPORT_TYPES = [['runway','滑走路飛行場'],['airship','空中艦飛行場'],['anchorage','泊地']];
export const PORT_TYPES = [['trade','貿易港'],['cargo','貨物港'],['supply','補給港']];
export const FACILITY_DURABILITY = [['temporary','臨時'],['permanent','恒久']];
export const BUILDING_LOGO_SCALE = 0.4;
export const BUILDING_LOGO_LIFT = 18;
export const BUILDING_DIAMETER = 50;
function option(value,options,label) {
  if(!options.some(([id])=>id===value))throw new Error(`${label}の設定が不正です。`);
  return value;
}
export function normalizeBuilding(value={}) {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('建築の設定が不正です。');
  const kind=option(value.kind??'airport',BUILDING_KINDS,'施設種別');
  const permanence=option(value.permanence??'temporary',FACILITY_DURABILITY,'施設区分');
  const airportType=option(value.airportType??'runway',AIRPORT_TYPES,'飛行場形式');
  const portType=option(value.portType??'cargo',PORT_TYPES,'港湾区分');
  const runways=value.runways??1;
  if(!Number.isInteger(runways)||runways<1||runways>3)throw new Error('滑走路数は1～3で指定してください。');
  return {...value,kind,permanence,airportType,portType,runways};
}
export function normalizeBuildingUnit(unit) {
  if(unit.branch!=='building')return unit;
  if((unit.sizeLevel??unit.snapshot.sizeLevel??1)!==1)throw new Error('建築の体型は現在1のみです。');
  unit.sizeLevel=1;unit.altitude=null;unit.underwater=false;unit.depth=0;
  unit.snapshot.building=normalizeBuilding(unit.snapshot.building);
  return unit;
}
export function buildingPlacement(sample) {
  if(!sample.inside || !Number.isFinite(sample.surface))return {valid:false,reason:'地図の範囲内に配置してください。'};
  return {valid:true,height:sample.surface,ground:sample.surface,note:`建築 / 地表高度：${sample.surface.toFixed(1)} / 直径50マス`};
}
const label=(options,key)=>options.find(([id])=>id===key)?.[1];
export function buildingDetailLines(unit) {
  const b=normalizeBuilding(unit.snapshot.building),stats=unit.snapshot.naval??{};
  return [
    `施設種別：${label(BUILDING_KINDS,b.kind)}`,
    `施設区分：${label(FACILITY_DURABILITY,b.permanence)}`,
    ...(b.kind==='airport'?[`形式：${label(AIRPORT_TYPES,b.airportType)}`,...(b.airportType==='runway'?[`滑走路数：${b.runways}`]:[])]:[`港湾区分：${label(PORT_TYPES,b.portType)}`]),
    '直径：50マス / 高度：地形に追随',
    ...[['装甲','armor'],['強度','strength'],['探測強度','detection'],['対海偵察','seaRecon'],['対空偵察','airRecon'],['対潜偵察','aswRecon']].map(([name,key])=>`${name}：${stats[key] === '' || stats[key] == null ? '未設定' : stats[key]}`)
  ];
}
const polygon=points=>points.map(([x,y],i)=>`${i?'L':'M'} ${x.toFixed(4)} ${y.toFixed(4)}`).join(' ')+' Z';
function ellipse(cx,cy,rx,ry,n=48){return polygon(Array.from({length:n},(_,i)=>[cx+Math.cos(i*Math.PI*2/n)*rx,cy+Math.sin(i*Math.PI*2/n)*ry]));}
function runway(angle,halfLength=16,cy=0){const a=angle*Math.PI/180;return polygon([[-1.5,-halfLength],[1.5,-halfLength],[1.5,halfLength],[-1.5,halfLength]].map(([x,y])=>[x*Math.cos(a)-y*Math.sin(a),cy+x*Math.sin(a)+y*Math.cos(a)]));}
export function buildingSymbolParts(value) {
  const b=normalizeBuilding(value),parts=[];
  const add=(role,d,fill='none')=>parts.push({role,d,fill});
  if(b.permanence==='permanent')add('base',ellipse(0,0,22,22));
  add('ring',ellipse(0,0,25,25));
  if(b.kind==='port') {
    // 锚与附加符号构成一组；附加符号不决定港口是否为永久设施。
    const anchor=[ellipse(0,-12,3.5,3.5,20),'M 0 -8.5 L 0 16 M -8 -3 L 8 -3 M -13 5 L -11 11 L -6 15 L 0 17 L 6 15 L 11 11 L 13 5 M -13 5 L -13 10 M -13 5 L -8 7 M 13 5 L 13 10 M 13 5 L 8 7'];
    for(const d of anchor)add('anchor',transformBuildingPath(d,(x,y)=>({x:x*.65-7,y:y*.8})));
    if(b.portType==='trade')add('trade','M 16 -9 L 13 -12 L 7 -12 L 4 -9 L 4 -5 L 7 -2 L 13 -2 L 16 1 L 16 5 L 13 8 L 7 8 L 4 5 M 10 -16 L 10 12');
    else if(b.portType==='cargo'){
      for(const [x,y] of [[6,-12],[1,0],[12,0]])add('cargo',polygon([[x,y],[x+8,y],[x+8,y+9],[x,y+9]]));
    }else add('supply','M 10 -17 L 10 -6 M 5 -6 L 15 -6 L 15 -2 L 12 1 L 12 5 L 9 9 L 5 9 L 2 6 L 2 2 M 7 -17 L 13 -17');
  } else if(b.airportType==='airship') {
    add('logo',ellipse(0,-4,16,7,32));
    add('logo','M -12 -8 L -19 -13 L -17 -4 L -19 3 L -12 0 M -6 3 L -4 9 L 5 9 L 7 2 M -4 -11 L -7 -15 L 3 -14 L 7 -10');
  } else {
    const count=b.airportType==='anchorage'?2:b.runways;
    const offset=b.airportType==='anchorage'?-5:0;
    const layout=count===1?[[90,16,0]]:count===2?[[90,16,0],[60,18,0]]:[[90,16,9],[-40,19,-2],[40,19,-2]];
    for(const [angle,length,y] of layout)add('runway',runway(angle,length,y+offset),'currentColor');
    if(b.airportType==='anchorage')add('wave','M -16 13 L -12 11 L -8 13 L -4 15 L 0 13 L 4 11 L 8 13 L 12 15 L 16 13 M -14 18 L -10 16 L -6 18 L -2 20 L 2 18 L 6 16 L 10 18 L 14 20');
  }
  return parts;
}
// 圆环投影在地面上，标志采用朝向观察者的竖直平面；抬升仅用于显示。
export function transformBuildingPath(path, transform) {
  return path.replace(/([ML])\s*(-?[\d.]+)\s+(-?[\d.]+)/g,(_,command,x,y)=>{const p=transform(Number(x),Number(y));return `${command} ${p.x.toFixed(4)} ${p.y.toFixed(4)}`;});
}
export function buildingPartPresentation(part) {
  return ['ring','base'].includes(part.role)?{plane:'ground',scale:1,lift:0}:{plane:'upright',scale:BUILDING_LOGO_SCALE,lift:BUILDING_LOGO_LIFT};
}
export function drawBuildingIcon(unit,parent,projectPath) {
  const ns='http://www.w3.org/2000/svg',icon=document.createElementNS(ns,'g');
  icon.setAttribute('class','unit-icon is-building');parent.append(icon);
  for(const part of buildingSymbolParts(unit.snapshot.building)){
    const presentation=buildingPartPresentation(part),path=document.createElementNS(ns,'path');
    path.setAttribute('d',presentation.plane==='ground'?projectPath(part.d):transformBuildingPath(part.d,(x,y)=>({x:x*presentation.scale,y:y*presentation.scale-presentation.lift})));
    path.setAttribute('class',`unit-symbol building-${part.role}`);path.setAttribute('data-plane',presentation.plane);
    path.setAttribute('style',`fill:${part.fill};stroke:${part.role==='runway'?'none':'currentColor'};stroke-width:${presentation.plane==='ground'?'1.2':'1.25'};stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke`);
    icon.append(path);
  }
  return 1;
}
