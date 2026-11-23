// 查询只读：不初始化运行状态、不按名称猜测支援能力。
export const SUPPORT_EFFECTS=[['','なし'],['repair-station','修理所（救助）'],['damage-control-station','損管所'],['supply-station','補給所'],['parking-stand','駐機枠'],['control-tower','管制塔']];
export const STATION_IDS=['repair-station','damage-control-station','supply-station','parking-stand','control-tower'];
export const SUPPORT_NAMES={rescue:'救助','damage-control':'外部損管',supply:'補給'};
export function supportCapacity(unit,effect){
 const snapshots=unit.snapshot?.equipmentSnapshots??[];
 if(!snapshots.some(item=>item.kind==='support'&&item.supportEffect===effect))return 0;
 const equipment=new Map(snapshots.map(item=>[item.id,item]));
 if(unit.equipmentState?.groups)return unit.equipmentState.groups.filter(group=>!group.damaged&&!group.destroyed&&equipment.get(group.equipmentId)?.kind==='support'&&equipment.get(group.equipmentId)?.supportEffect===effect).length;
 return (unit.snapshot?.mounts??[]).reduce((n,m)=>n+(equipment.get(m.equipmentId)?.kind==='support'&&equipment.get(m.equipmentId)?.supportEffect===effect&&Number.isSafeInteger(m.count)&&m.count>0?m.count:0),0);
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
 ['parking-stand','駐機枠','組数は駐機枠数です。航空機数とは異なります。使用規則は今後接続します。'],
 ['control-tower','管制塔','滑走路の起降管制用。管制可能数・処理規則は未設定です。']
 ].map(([supportEffect,name,note])=>({id:'eq-support-'+supportEffect,name,kind:'support',supportEffect,note,runwayControlLimit:null,barrelCount:null,projectionCoefficient:null,projectionSuffix:'',ammo:null,slot:'',powerRule:'',penetration:'',ceilingU:null,range:null,maxOrder:'',guidance:'',targetScope:''}));}
