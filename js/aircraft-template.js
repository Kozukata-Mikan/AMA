// 航空机资料使用独立模板；不把小破／中破或舰船训练效果套入航空机。
export const AIRCRAFT_TYPES = [
  ['carrier','艦載機'], ['land','陸上機'], ['seaplane','水上機'],
  ['drone','無人機'], ['land-drone','陸上無人機']
];
export const AIRCRAFT_WEAPON_ROLES = [
  ['active','主動武器'], ['defense','自衛武器'], ['pod','ポッド']
];
export const isDroneType = type => ['drone','land-drone'].includes(type);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function integer(value,label,min=0) {
  if(!Number.isSafeInteger(value)||value<min)throw new Error(`${label}は${min}以上の整数で指定してください。`);
  return value;
}
export function parseAircraftEndurance(value) {
  const match=String(value??'').trim().match(/^(\d+(?:\.\d+)?)\s*(k)?$/i);
  if(!match)throw new Error('航続距離は数値または「1k」の形式で指定してください。');
  const result=Number(match[1])*(match[2]?1000:1);
  if(!Number.isFinite(result))throw new Error('航続距離の値が不正です。');
  return result;
}
export function aircraftAirTime(endurance,speed) {
  if(endurance===''||endurance==null||speed==null)return null;
  if(!Number.isFinite(speed)||speed<=0)throw new Error('最高速度は0より大きい数値で指定してください。');
  const result=Math.floor(parseAircraftEndurance(endurance)/(speed/2));
  if(!Number.isSafeInteger(result))throw new Error('滞空時間の値が範囲外です。');
  return result;
}
export function normalizeAircraft(value={}) {
  if(!object(value)||value.version!==undefined&&value.version!==1)throw new Error('航空機資料の書式が不正です。');
  const type=value.type??'carrier';
  if(!AIRCRAFT_TYPES.some(([id])=>id===type))throw new Error('航空機の種別が不正です。');
  const engines=integer(value.engines??1,'発動機数',1),crew=integer(value.crew??(isDroneType(type)?0:1),'乗員数');
  for(const key of ['maneuverability','training'])if(value[key]!==undefined&&typeof value[key]!=='string')throw new Error('機動性・練度は文字列で指定してください。');
  const maneuverability=String(value.maneuverability??'').trim();
  if(maneuverability&&!/^(?:\d+(?:\.\d+)?)\s*R$/i.test(maneuverability))throw new Error('機動性は「1R」「2R」の形式で指定してください。');
  const ceiling=value.ceiling??null;
  if(ceiling!==null&&(!Number.isFinite(ceiling)||ceiling<1))throw new Error('上昇限度は高度1以上で指定してください。');
  const remoteRange=value.remoteRange??null;
  if(remoteRange!==null&&(!Number.isFinite(remoteRange)||remoteRange<0))throw new Error('遠隔操作範囲の値が不正です。');
  const training=String(value.training??'').trim();
  const loadouts=value.loadouts??[];
  if(!Array.isArray(loadouts)||loadouts.length>100)throw new Error('搭載構成は100件以内の一覧で指定してください。');
  const ids=new Set();
  const normalized=loadouts.map((entry,i)=>{
    if(!object(entry)||typeof entry.name!=='string'||!entry.name.trim()||!Array.isArray(entry.mounts))throw new Error('搭載構成の名称・装備一覧を確認してください。');
    const id=entry.id??`loadout-${i+1}`;
    if(typeof id!=='string'||!id||ids.has(id))throw new Error('搭載構成IDが重複または不正です。');
    ids.add(id);
    return{id,name:entry.name.trim(),mounts:entry.mounts.map(m=>{
      if(!object(m)||typeof m.equipmentId!=='string'||!m.equipmentId)throw new Error('搭載装備IDが不正です。');
      return{equipmentId:m.equipmentId,count:integer(m.count??1,'搭載装備数',1)};
    })};
  });
  return {...value,version:1,type,engines,crew,maneuverability:maneuverability.replace(/\s/g,'').toUpperCase(),ceiling,training,remoteRange,loadouts:normalized,
    operations:{takeoff:'runway-or-catapult',preparation:'preparation-area'}};
}
export const aircraftParkingSlots = aircraft => normalizeAircraft(aircraft).engines;
export function aircraftMounts(unit) {
  return [...(unit.mounts??[]),...(unit.branch==='air'?unit.aircraft?.loadouts??[]:[]).flatMap(loadout=>loadout.mounts)];
}
export function aircraftFacilityCompatible(type,host) {
  if(!AIRCRAFT_TYPES.some(([id])=>id===type))return false;
  const branch=host.branch??host.snapshot?.branch,b=host.building??host.snapshot?.building;
  const water=type==='seaplane',land=['land','land-drone'].includes(type);
  if(branch==='navy')return !land;
  if(branch!=='building'||b?.kind!=='airport')return false;
  return water?b.airportType==='anchorage':b.airportType!=='anchorage';
}

export function activeAircraftMounts(unit){
 const base=unit.snapshot?.mounts??[];
 if(unit.branch!=='air'||!unit.aircraftState?.activeLoadoutId)return base;
 const loadout=unit.snapshot.aircraft?.loadouts?.find(l=>l.id===unit.aircraftState.activeLoadoutId);
 if(!loadout)throw new Error('選択した掛載構成がありません。');
 return [...base,...loadout.mounts.map(m=>({...m,position:'掛載'}))];
}
