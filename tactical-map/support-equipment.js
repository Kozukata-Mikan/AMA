import {buildingMountAvailable,buildingAlive} from './building-state.js?v=facility-rules-1';
// Read-only role lookup; legacy names below are explicit compatibility aliases.
export const SUPPORT_EFFECTS=[['','なし'],['repair-station','修理所（救助）'],['damage-control-station','損管所'],['supply-station','補給所'],['parking-stand','駐機枠'],['remote-station','遠隔操作所'],['ground-crew','地上整備員'],['night-observation','夜間観測'],['preparation-area','整備区'],['runway','滑走路'],['catapult','カタパルト'],['mine','機雷'],['mine-guard','掃海具'],['boat','舟艇'],['observation-balloon','観測気球'],['spotter','観測員'],['rato','RATO発進補助'],['electronic-warfare-pod','電子戦ポッド'],['flare','フレア']];
export const STATION_IDS=['repair-station','damage-control-station','supply-station','parking-stand','control-tower','remote-station','ground-crew','night-observation','preparation-area','runway','catapult','mine','mine-guard','boat','observation-balloon','spotter','rato','electronic-warfare-pod','flare'];
const LEGACY_SUPPORT_NAMES=new Map([['观测气球','observation-balloon'],['観測気球','observation-balloon'],['破雷卫','mine-guard'],['破雷衛','mine-guard'],['舟艇','boat']]);
export const supportEffectOf=equipment=>equipment?.supportEffect||(equipment?.kind==='support'?(equipment.id==='eq-seaplane-catapult'?'catapult':LEGACY_SUPPORT_NAMES.get(equipment.name?.trim())??(/(?:弹射器|彈射器|カタパルト)/.test(equipment.name??'')?'catapult':'')):'');
export const SUPPORT_NAMES={rescue:'救助','damage-control':'外部損管',supply:'補給'};
export function supportCapacity(unit,effect){
 const snapshots=unit.snapshot?.equipmentSnapshots??[];
 if(!snapshots.some(item=>item.kind==='support'&&supportEffectOf(item)===effect))return 0;
 const equipment=new Map(snapshots.map(item=>[item.id,item]));
 if(unit.equipmentState?.groups)return unit.equipmentState.groups.filter(group=>buildingMountAvailable(unit,group.mountIndex)&&!group.damaged&&!group.destroyed&&!group.consumed&&equipment.get(group.equipmentId)?.kind==='support'&&supportEffectOf(equipment.get(group.equipmentId))===effect).length;
 return (unit.snapshot?.mounts??[]).reduce((n,m,index)=>n+(buildingMountAvailable(unit,index)&&equipment.get(m.equipmentId)?.kind==='support'&&supportEffectOf(equipment.get(m.equipmentId))===effect&&Number.isSafeInteger(m.count)&&m.count>0?m.count:0),0);
}
export const hasSupportEquipment=unit=>(unit.snapshot?.equipmentSnapshots??[]).some(item=>item.kind==='support'&&STATION_IDS.includes(supportEffectOf(item)));
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
 ['catapult','カタパルト','RATO搭載機のみ、1基につき毎ラウンド最大3機。同ラウンドの移動段階から飛行できます。'],
 ['mine','機雷','特殊段階に現在の海域へ敷設します。他陣営の艦船が5マス以内を通過すると起爆し、威力1（水下）を適用します。'],
 ['mine-guard','掃海具','機雷を起爆させず、周囲の機雷を除去できます。'],
 ['boat','舟艇','機能は後続規則で定義します。現時点では追加効果はありません。'],
 ['observation-balloon','観測気球','高度30の係留気球を展開し、偵察視点を高くします。特殊段階で上げ下げします。展開中は校射＋1。全校射源の合計は最大＋1。'],
 ['spotter','観測員','装備するユニットの校射＋1。気球を含む全校射源の合計は最大＋1。'],
 ['electronic-warfare-pod','電子戦ポッド','1組で電子攻撃または電子防御5点。直径1500マスの範囲で対抗し、20/30/40/50点差の電子圧制を適用します。'],
 ['flare','フレア','1組を消費して同一次序のレーダー・数値制御攻撃を無効化。1ユニット1ラウンド1回、自動使用は初期ON。強ロック中は使用不可。'],
 ['rato','RATO発進補助','搭載機がカタパルトを使用するための発進補助装置です。']
 ].map(([supportEffect,name,note])=>({id:'eq-support-'+supportEffect,name,kind:'support',supportEffect,note,remoteRange:supportEffect==='remote-station'?0:null,barrelCount:null,projectionCoefficient:null,projectionSuffix:'',ammo:null,slot:'',powerRule:'',penetration:'',ceilingU:null,range:null,maxOrder:'',guidance:'',targetScope:''}));}
