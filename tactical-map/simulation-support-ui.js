import {supportCapacity,inSupportRange,SUPPORT_NAMES} from './support-equipment.js?v=air-training-1';
import {needsSupport,supportLimit} from './simulation-support.js?v=air-losses-1';
export function mountSupportUI(store){
 const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const panel=el('details');panel.dataset.workflowPanel='support';panel.dataset.toolCategory='progress';panel.open=true;panel.append(el('summary','外部支援・救助・補給'));
 const provider=el('select'),kind=el('select'),target=el('select');for(const [id,name]of Object.entries(SUPPORT_NAMES))kind.append(new Option(name,id));
 for(const [name,control]of [['支援するユニット',provider],['支援内容',kind],['支援を受ける艦船',target]]){const label=el('label');label.append(el('span',name),control);panel.append(label);}
 const note=el('p','特殊段階で支援円内の味方艦を指定します。艦船の支援円は直径25マス、施設は直径50マスです。支援中の双方は移動できません。救助中は従来どおり攻撃もできません。移動を確定すると支援を中止します。救助は第2ラウンドに判定。外部損管は通常と同じ失敗の影響があります。補給は毎ラウンド最大25%です。');note.className='note';
 const slots=el('p'),message=el('p'),tasks=el('div'),start=el('button','支援を開始');start.type='button';message.setAttribute('role','status');
 panel.append(note,slots,start,message,tasks);document.querySelector('aside').append(panel);
 function sync(){
  const scene=store.getSceneSnapshot(),old=provider.value,oldTarget=target.value;
  provider.replaceChildren(new Option('支援側を選択してください',''));
  for(const unit of scene.instances.filter(u=>!u.aviationStored&&u.observationOwn&&u.x!=null&&u.y!=null&&u.currentHp>=0&&(u.branch==='navy'||['repair-station','damage-control-station','supply-station'].some(role=>supportCapacity(u,role)>0))))provider.append(new Option(unit.name,unit.instanceId));
  if([...provider.options].some(o=>o.value===old))provider.value=old;
  const p=scene.instances.find(u=>u.instanceId===provider.value);target.replaceChildren(new Option('対象艦を選択してください',''));
  if(p)for(const unit of scene.instances.filter(u=>u.observationOwn&&u.instanceId!==p.instanceId&&inSupportRange(p,u)&&needsSupport(u,kind.value)))target.append(new Option(unit.name,unit.instanceId));
  if([...target.options].some(o=>o.value===oldTarget))target.value=oldTarget;
  const active=(scene.supportRuntime?.tasks??[]).filter(t=>t.status==='active');
  slots.textContent=p?`同時支援枠：${active.filter(t=>t.providerId===p.instanceId&&t.kind===kind.value).length} / ${supportLimit(p,kind.value)}（正常な設備組数に基づきます）`:'';
  start.disabled=scene.turn.phaseId!=='special'||!p||!target.value;
  tasks.replaceChildren();for(const task of scene.supportRuntime?.tasks??[]){if(!scene.instances.some(u=>u.instanceId===task.providerId&&u.observationOwn))continue;const row=el('p',`${SUPPORT_NAMES[task.kind]}：${scene.instances.find(u=>u.instanceId===task.providerId)?.name} → ${scene.instances.find(u=>u.instanceId===task.targetId)?.name} / ${({active:'支援中',complete:'完了',failed:'失敗',interrupted:'中止'})[task.status]}`);if(task.status==='active'){const cancel=el('button','支援を中止');cancel.type='button';cancel.disabled=!['movement','special'].includes(scene.turn.phaseId);cancel.addEventListener('click',async()=>{try{await store.cancelSupport(task.id);}catch(e){message.textContent=e.message;}});row.append(cancel);}tasks.append(row);}
 }
 start.addEventListener('click',async()=>{try{await store.startSupport({providerId:provider.value,targetId:target.value,kind:kind.value});message.textContent='支援を開始しました。特殊段階の処理で結果を確定します。';}catch(e){message.textContent=e.message;}});
 provider.addEventListener('change',()=>{const id=provider.value;sync();document.dispatchEvent(new CustomEvent('support-provider-select',{detail:id}));});kind.addEventListener('change',sync);target.addEventListener('change',()=>{start.disabled=store.getSceneSnapshot().turn.phaseId!=='special'||!provider.value||!target.value;});
 const unsubscribe=store.subscribe(sync);sync();return()=>{unsubscribe();panel.remove();};
}
