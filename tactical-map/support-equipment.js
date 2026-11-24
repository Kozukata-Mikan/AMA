import {buildingMountAvailable,buildingAlive} from './building-state.js?v=facility-rules-1';
// 查询只读：不初始化运行状态、不按名称猜测支援能力。
export const SUPPORT_EFFECTS=[['','なし'],['repair-station','修理所（救助）'],['damage-control-station','損管所'],['supply-station','補給所'],['parking-stand','駐機枠'],['remote-station','遠隔操作所'],['ground-crew','地上整備員'],['night-observation','夜間観測'],['preparation-area','整備区'],['runway','滑走路'],['catapult','カタパルト']];
export const STATION_IDS=['repair-station','damage-control-station','supply-station','parking-stand','control-tower','remote-station','ground-crew','night-observation','preparation-area','runway','catapult'];
export const SUPPORT_NAMES={rescue:'救助','damage-control':'外部損管',supply:'補給'};
export function supportCapacity(unit,effect){
 const snapshots=unit.snapshot?.equipmentSnapshots??[];
 if(!snapshots.some(item=>item.kind==='support'&&item.supportEffect===effect))return 0;
 const equipment=new Map(snapshots.map(item=>[item.id,item]));
 if(unit.equipmentState?.groups)return unit.equipmentState.groups.filter(group=>buildingMountAvailable(unit,group.mountIndex)&&!group.damaged&&!group.destroyed&&equipment.get(group.equipmentId)?.kind==='support'&&equipment.get(group.equipmentId)?.supportEffect===effect).length;
 return (unit.snapshot?.mounts??[]).reduce((n,m,index)=>n+(buildingMountAvailable(unit,index)&&equipment.get(m.equipmentId)?.kind==='support'&&equipment.get(m.equipmentId)?.supportEffect===effect&&Number.isSafeInteger(m.count)&&m.count>0?m.count:0),0);
}
export const hasSupportEquipment=unit=>(unit.snapshot?.equipmentSnapshots??[]).some(item=>item.kind==='support'&&STATION_IDS.includes(item.supportEffect));
export const supportRadius=unit=>unit.branch==='building'?25:12.5;
export const inSupportRange=(provider,target)=>[provider.x,provider.y,target.x,target.y].every(Number.isFinite)&&Math.hypot(provider.x-target.x,provider.y-target.y)<=supportRadius(provider)+1e-7;
export const supportActive=scene=>(scene.supportRuntime?.tasks??[]).filter(task=>task.status==='active');
export const supportConflicts=(scene,ids)=>{const members=new Set(ids);return supportActive(scene).filter(t=>members.has(t.providerId)||members.has(t.targetId));};
export const rescueSupported=(scene,id)=>supportActive(scene).some(task=>task.kind==='rescue'&&task.targetId===id);
export function synchronizeSupportLocks(scene){
 const locked=new Set(),rescueLocked=new Set();for(const task of supportActive(scene)){locked.add(task.providerId);locked.add(task.targetId);if(task.kind==='rescue'){rescueLocked.add(task.providerId);rescueLocked.add(task.targetId);}}
 for(const unit of scene.instances){unit.supportLocked=locked.has(unit.instanceId);unit.rescueSupportLocked=rescueLocked.has(unit.instanceId);}
}
export function supportEquipmentSeed(){return [
 ['repair-station','修理所','沈没寸前の艦船を第2ラウンドに必ず救助します。組数が同時救助数です。'],
 ['damage-control-station','損管所','対象艦に通常と同じ損管判定を追加で実施します。失敗時の影響も同じです。'],
 ['supply-station','補給所','毎ラウンド、初期総航続距離の最大25%を回復します。'],
 ['parking-stand','駐機枠','組数は駐機枠数です。航空機数とは異なります。搭載・着陸時に発動機数に応じて消費します。'],
 ['remote-station','遠隔操作所','同陣営の無人機は有効な遠隔操作範囲内で行動します。範囲外では滞空時間が直ちに0になります。'],
 ['night-observation','夜間観測','機体に装備すると全時間帯の飛行・起降が可能です。母艦・施設に装備すると夜間整備が可能です。'],
 ['ground-crew','地上整備員','1組につき毎ラウンド1耐性を修復。損傷が少ない駐機中の航空機から集中して全快させます。'],
 ['preparation-area','整備区','1組につき毎ラウンド最大9機を整備します。機位数ではなく機数です。'],
 ['runway','滑走路','1本につき毎ラウンド最大27機。同一ラウンドに離陸・着陸を併用できません。'],
 ['catapult','カタパルト','1基につき毎ラウンド最大3機。同ラウンドの移動段階から飛行できます。']
 ].map(([supportEffect,name,note])=>({id:'eq-support-'+supportEffect,name,kind:'support',supportEffect,note,remoteRange:supportEffect==='remote-station'?0:null,barrelCount:null,projectionCoefficient:null,projectionSuffix:'',ammo:null,slot:'',powerRule:'',penetration:'',ceilingU:null,range:null,maxOrder:'',guidance:'',targetScope:''}));}
