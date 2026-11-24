import {aircraftMayFly} from './aviation-time.js?v=day-catalog-pas-1';
import {hasAircraftTemplate,aircraftCanAct} from './aircraft-runtime.js?v=air-losses-1';
const el=(tag,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
export function mountAirCombatUI(store){
 const panel=el('details');panel.open=true;panel.dataset.toolCategory='attack';panel.dataset.workflowPanel='air-combat';panel.append(el('summary','空対空戦闘｜小隊・機動・反応力'));
 const actor=el('select'),target=el('select');for(const [label,control]of [['空戦を開始する機隊',actor],['識別済みの敵機隊',target]]){const row=el('label');row.append(el('span',label),control);panel.append(row);}
 const note=el('p','最大27機の機隊を選択し、現在の次序の一括結算で空戦を処理します。3機ごとの小隊と端数の単機小隊に分かれ、双方の攻撃は各交戦内で同時に成立します。');const save=el('button','空戦計画を保存');save.type='button';const status=el('p'),plans=el('div'),history=el('div');status.setAttribute('role','status');panel.append(note,save,status,plans,history);document.querySelector('aside').append(panel);
 const choices=new Map();let scene;
 function options(control,planes){const selected=control.value;control.replaceChildren(new Option('機隊・機体を選択',''));const groups=new Map();for(const p of planes){const id=p.groupId??p.instanceId;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p);}for(const [key,members]of groups){const id=JSON.stringify(members.map(p=>p.instanceId));choices.set(id,members.map(p=>p.instanceId));const group=scene.groups.find(g=>g.id===key);control.append(new Option(`${group?.name??members[0].name}（${members.length}機）`,id));}if([...control.options].some(o=>o.value===selected))control.value=selected;}
 function sync(){scene=store.getSceneSnapshot();choices.clear();options(actor,scene.instances.filter(p=>p.observationOwn&&hasAircraftTemplate(p)&&aircraftCanAct(p,'attack')&&aircraftMayFly(scene,p)));options(target,scene.instances.filter(p=>!p.observationOwn&&p.observationLevel==='identified'&&hasAircraftTemplate(p)));save.disabled=!/^order-[1-5]$/.test(scene.turn.phaseId)||!actor.value||!target.value;plans.replaceChildren();for(const c of scene.airCombatRuntime?.commands??[]){const row=el('p',`登録済み：${c.actorIds.length}機 → ${c.targetIds.length}機 / ${c.phaseId}`),cancel=el('button','この空戦計画を取消');cancel.type='button';cancel.addEventListener('click',async()=>{try{await store.cancelAirCombat(c.id);}catch(e){status.textContent=e.message;}});row.append(cancel);plans.append(row);}
  history.replaceChildren(el('h4','自陣営が参加した空戦記録'));
  for(const record of (scene.airCombatRuntime?.records??[]).slice(-12).reverse()){
   const details=el('details');details.append(el('summary',`ラウンド${record.turnNumber} / ${record.phaseId} / ${record.duels.length}交戦`));
   for(const d of record.duels){
    const outcome=d.skipped?'双方が迎戦不能のため交戦なし':`${d.heads?.[0]??0}対${d.heads?.[1]??0} / ${({left:'左側優勢',right:'右側優勢',tie:'同数・双方主動武器'})[d.outcome]}`;
    details.append(el('p',`${d.left.join('・')} ↔ ${d.right.join('・')}：${outcome}`));
    if(d.dice)details.append(el('p',d.dice.some(list=>list.length)?d.dice.map((list,i)=>`${i===0?'左':'右'}機動硬貨：${list.map(head=>head?'表':'裏').join('・')}`).join(' / '):'機動判定は反応力判定による優劣のため省略しました。'));
    if(d.readiness)details.append(el('p',d.readiness.map((r,i)=>`${i===0?'左':'右'}反応：${({first:'初回',exhausted:'反応力を使い切り',unable:'行動不能','reaction-success':'表・通常対決','reaction-failed':'裏・機動敗北'})[r.reason]}`).join(' / ')));
    if(d.maneuver)details.append(el('p',d.maneuver.map((r,i)=>`${i===0?'左':'右'}練度固定：表${r.fixedHeads}・裏${r.fixedTails}`).join(' / ')));
    for(const panic of d.panic??[])details.append(el('p',`${panic.aircraftName}：恐慌${panic.count} / 閾値${panic.threshold} / ${({normal:'通常',confused:'混乱',retreating:'撤退'})[panic.state]}${panic.immune?'（無畏）':''}`));
    for(const loss of d.aceLosses??[])details.append(el('p',`ACE ${loss.pilotName}戦死：${loss.success?'後継 '+loss.heirName+'・エース維持':'精鋭へ降格'}`));
    for(const shot of d.shots??[])details.append(el('p',`${shot.ambush?'【伏撃】 ':''}${shot.actor} → ${shot.target} / ${shot.role} / ${shot.weaponName}：${shot.hitCount}命中${shot.disruptionPenalty?` / 対空妨害・不利${shot.disruptionPenalty}`:''}`));
   }history.append(details);
  }
 }
 for(const control of [actor,target])control.addEventListener('change',()=>{save.disabled=!/^order-[1-5]$/.test(scene.turn.phaseId)||!actor.value||!target.value;const ids=choices.get(control.value);if(ids?.length)document.dispatchEvent(new CustomEvent('tactical-unit-selection',{detail:{kind:'unit',id:ids[0]}}));});
 save.addEventListener('click',async()=>{try{await store.saveAirCombat({actorIds:choices.get(actor.value),targetIds:choices.get(target.value)});status.textContent='空戦計画を保存しました。現在の攻撃段階の一括結算で実行します。';}catch(e){status.textContent=e.message;}});
 const unsubscribe=store.subscribe(sync);sync();return()=>{unsubscribe();panel.remove();};
}
