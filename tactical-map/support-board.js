import {indexSupportRoster,filterSupportRoster} from './support-roster.js';
import {conditionLabel,effectLabel,equipmentStatus,supportCompartments} from './support-condition.js';
import {SUPPORT_NAMES} from './support-equipment.js?v=visual-support-bridge-1';

function el(tag,text='',className=''){
 const element=document.createElement(tag);
 element.textContent=text;
 if(className)element.className=className;
 return element;
}
function button(text,action){
 const control=el('button',text);
 control.type='button';
 control.addEventListener('click',action);
 return control;
}
function metric(label,value){
 const box=el('div','','support-metric');
 box.append(el('small',label),el('strong',value));
 return box;
}
function effects(container,state,includeFlood=true){
 if(!state)return;
 for(const [key,title] of (includeFlood?[['fire','火災'],['flooding','浸水']]:[['fire','火災']])){
  const effect=state[key];
  const row=el('p',title+' · '+effectLabel(key,effect),effect?'support-alert':'');
  if(effect)row.append(el('small',`R${effect.acquiredTurn} 発生 · 損管失敗 ${effect.failedControls}回`));
  container.append(row);
 }
 if(state.lastResolvedTurn>0)container.append(el('small',`直近の損管判定 R${state.lastResolvedTurn}`));
}
function partCard(part,names){
 const card=el('article','','support-part'),head=el('header');
 head.append(el('strong',part.label));
 if(part.status)head.append(el('span',part.status,part.status==='正常'?'support-ok':'support-alert'));
 card.append(head);
 if(part.hp!=null){
  const bar=el('progress');bar.max=part.maxHp||1;bar.value=part.hp;
  card.append(el('p',`耐性 ${part.hp} / ${part.maxHp} · 損失 ${part.maxHp-part.hp}`),bar);
 }
 if(part.damagedTurn)card.append(el('small','損傷 R'+part.damagedTurn));
 effects(card,part.effects,false);
 // Collapse identical groups while preserving distinctions between damaged and intact installations.
 const entries=new Map();
 for(const g of part.equipment){
  const status=equipmentStatus(g),name=names.get(g.equipmentId)??g.equipmentId,key=JSON.stringify([g.equipmentId,status]);
  if(!entries.has(key))entries.set(key,{name,status,count:0});
  entries.get(key).count++;
 }
 for(const {name,status,count} of entries.values()){
  const line=el('div','','support-equipment-line');
  line.append(el('span',name+' ×'+count),el('small',status,status==='損傷'||status==='完全破損'?'support-alert':''));
  card.append(line);
 }
 if(!entries.size)card.append(el('small','配置装備なし'));
 return card;
}
const phases={start:'ラウンド開始',movement:'移動',special:'特殊',end:'ラウンド終了',pas:'PAS'};
export function mountSupportBoard(store,sections){
 const css=el('link');css.rel='stylesheet';css.href=new URL('./support-board.css',import.meta.url).href;document.head.append(css);
 const entry=el('details');entry.dataset.workflowPanel='support';entry.dataset.toolCategory='progress';entry.open=true;
 const dialog=el('dialog','','aviation-board support-board');dialog.setAttribute('aria-label','支援管制センター');
 const open=button('支援管制センターを開く',()=>{dialog.showModal();refresh();});
 entry.append(el('summary','支援装備・損管'),open);document.querySelector('aside').append(entry);
 const header=el('header','','aviation-board-head'),round=el('span');
 header.append(el('h2','支援管制センター'),round,button('閉じる',()=>dialog.close()));
 const stats=el('div','','support-stats'),grid=el('div','','support-grid');
 const fleet=el('section','','support-column'),search=el('input'),filter=el('label'),check=el('input'),roster=el('div','','support-roster');
 search.type='search';search.placeholder='ユニット名・編隊名を検索';search.setAttribute('aria-label',search.placeholder);
 check.type='checkbox';filter.append(check,' 要対応のみ');
 const formation=el('select'),resultCount=el('small');
 formation.setAttribute('aria-label','編隊で絞り込み');formation.className='support-formation';
 resultCount.setAttribute('role','status');
 fleet.append(el('h3','自陣営ユニット'),search,formation,filter,resultCount,roster);
 const detail=el('section','','support-column'),unitTitle=el('h3'),condition=el('div','','support-condition'),parts=el('div','','support-parts');
 detail.append(unitTitle,condition,parts);
 const actions=el('section','','support-column'),tabs=el('div','','support-tabs'),actionBody=el('div','','support-action-body'),activeTasks=el('div');
 actions.append(el('h3','支援操作'),tabs,actionBody,activeTasks);
 grid.append(fleet,detail,actions);dialog.append(header,stats,grid);document.body.append(dialog);
 let selected='',tab=0,mountedKey=null,unmount=null,visibleCount=80;
 const tabButtons=['救助・損管・補給・防雷網','機雷・気球','電子戦・フレア','発煙・照明','輸送庫'].map((label,i)=>{
  const b=button(label,()=>{tab=i;refresh();});tabs.append(b);return b;
 });
 function renderActions(unit,scene){
  tabButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String(tab===i)));
  const key=JSON.stringify([selected,tab]);
  if(key!==mountedKey){
   unmount?.();unmount=null;mountedKey=key;actionBody.replaceChildren();
   if(unit){
    unmount=sections[tab](store,actionBody,()=>selected);
    const panel=actionBody.querySelector('details');panel.open=true;panel.querySelector('summary').hidden=true;
   }
  }
  activeTasks.replaceChildren();
  if(!unit)return;
  const legacy=(scene.rescueTasks??[]).map(task=>({...task,providerId:task.rescuerId}));
  const tasks=[...(scene.supportRuntime?.tasks??[]),...legacy].filter(t=>t.status==='active'&&[t.providerId,t.targetId].includes(selected));
  activeTasks.append(el('h4','進行中の支援'));
  if(!tasks.length)activeTasks.append(el('small','任務なし'));
  for(const t of tasks){
   const peer=scene.instances.find(u=>u.instanceId===(selected===t.targetId?t.providerId:t.targetId));
   activeTasks.append(el('p',`${SUPPORT_NAMES[t.kind]??'設備修復'} · ${selected===t.targetId?'受援元':'支援先'} ${peer?.name??'—'} · R${t.startedTurn} 開始`));
  }
 }
 let indexedScene=null,index;
 function refresh(){
  if(!dialog.open)return;
  const scene=store.getSceneSnapshot();
  if(scene!==indexedScene){
   index=indexSupportRoster(scene);indexedScene=scene;
   const previous=formation.value;
   formation.replaceChildren(new Option('すべての編隊',''),...index.options.map(g=>
    new Option(`${g.label}（${g.total}・要対応 ${g.attention}）`,g.id)));
   if(index.options.some(g=>g.id===previous))formation.value=previous;
  }
  const {own,damaged}=index;
  const shown=filterSupportRoster(index,formation.value,search.value,check.checked);
  resultCount.textContent=`該当 ${shown.length} ユニット`;
  if(!shown.some(u=>u.instanceId===selected))selected=shown[0]?.instanceId??'';
  const unit=shown.find(u=>u.instanceId===selected);
  round.textContent=`R${scene.turn.number} · ${phases[scene.turn.phaseId]??scene.turn.phaseId.replace('order-','次序 ')}`;
  const fire=own.filter(u=>u.shipState?.effects?.fire||u.buildingState?.slots?.some(s=>s.effects?.fire)).length;
  stats.replaceChildren(metric('自陣営',own.length),metric('要対応',damaged.size),metric('火災',fire),metric('浸水',own.filter(u=>u.shipState?.effects?.flooding).length),metric('沈没寸前',own.filter(u=>u.shipState?.status==='sinking').length));
  roster.replaceChildren();
  for(const u of shown.slice(0,visibleCount)){
   const b=button('',()=>{selected=u.instanceId;refresh();});b.setAttribute('aria-pressed',String(selected===u.instanceId));
   b.append(el('strong',u.name),el('small',`${conditionLabel(u)} · 耐性 ${u.currentHp} / ${u.snapshot.maxHp}`));
   b.append(el('small',index.members.get(u.instanceId).group.label||'編隊なし'));roster.append(b);
  }
  if(shown.length>visibleCount)roster.append(button('さらに表示（残り '+(shown.length-visibleCount)+'）',()=>{visibleCount+=80;refresh();}));
  if(!shown.length)roster.append(el('p','該当ユニットなし'));
  condition.replaceChildren();parts.replaceChildren();unitTitle.textContent=unit?.name??'ユニット未選択';
  if(unit){
   condition.append(metric('耐性',`${unit.currentHp} / ${unit.snapshot.maxHp}`),metric('耐性損失',Math.max(0,unit.snapshot.maxHp-unit.currentHp)),metric('状態',conditionLabel(unit)));
   if(unit.shipState?.effects){const block=el('div','','support-effects');effects(block,unit.shipState.effects);condition.append(block);}
   const names=new Map((unit.snapshot.equipmentSnapshots??[]).map(e=>[e.id,e.name]));
   const compartments=supportCompartments(unit);
   if(unit.branch==='navy')parts.append(el('small','耐性・火災・浸水は艦全体、設備の損傷は部位別に表示します。','support-wide'));
   for(const part of compartments)parts.append(partCard(part,names));
   if(!compartments.length)parts.append(el('small','部位別の配置設備なし'));
  }
  renderActions(unit,scene);
 }
 function updateFilter(){visibleCount=80;roster.scrollTop=0;refresh();}
 search.addEventListener('input',updateFilter);check.addEventListener('change',updateFilter);
 formation.addEventListener('change',updateFilter);
 const unsubscribe=store.subscribe(refresh);
 dialog.addEventListener('close',()=>{if(dialog.open)return;unmount?.();unmount=null;mountedKey=null;});
 return ()=>{unsubscribe();unmount?.();dialog.remove();entry.remove();css.remove();};
}
