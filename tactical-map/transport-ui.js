import {transportOptions,isCargoPort} from './transport-hold.js';

function el(tag,text=''){const n=document.createElement(tag);n.textContent=text;return n;}
export function mountTransportUI(store,container,selectedUnit){
 const panel=el('details'),body=el('div'),message=el('p');
 message.setAttribute('role','status');panel.open=true;panel.append(el('summary','輸送庫'),body,message);container.append(panel);
 let mode='load',receiverId='',busy=false;const checked=new Set();
 function sync(){
  const scene=store.getSceneSnapshot(),units=scene.instances.filter(u=>u.observationOwn),byId=new Map(units.map(u=>[u.instanceId,u]));
  const host=byId.get(selectedUnit());body.replaceChildren();if(!host)return;
  const options=transportOptions(units,host,id=>byId.get(id)?.transportManifest??[]);
  body.append(el('strong',options.port?'港内保管 · '+options.cargo.length:`輸送庫 · ${options.cargo.length} / ${options.capacity}`));
  if(!options.port&&!options.capacity&&!options.cargo.length){body.append(el('p','使用可能な輸送庫がありません。'));return;}
  const tabs=el('div');tabs.className='support-tabs';body.append(tabs);
  for(const [key,label] of [['load','積み込み'],['transfer','移送'],...(options.port?[['unload','陸上へ荷下ろし']]:[])]){
   const tab=el('button',label);tab.type='button';tab.setAttribute('aria-pressed',String(mode===key));
   tab.onclick=()=>{mode=key;checked.clear();message.textContent='';sync();};tabs.append(tab);
  }
  const rows=mode==='load'?options.load.map(u=>({id:u.instanceId,name:u.name})):options.cargo;
  const visible=new Set(rows.map(r=>r.id));for(const id of checked)if(!visible.has(id))checked.delete(id);
  if(mode==='transfer'){
   const dest=el('select');dest.setAttribute('aria-label','移送先');dest.append(new Option('移送先を選択',''));
   for(const u of options.receivers)dest.append(new Option(u.name+(isCargoPort(u)?'（港）':''),u.instanceId));
   if(options.receivers.some(u=>u.instanceId===receiverId))dest.value=receiverId;else receiverId='';
   dest.onchange=()=>{receiverId=dest.value;sync();};body.append(dest);
  }
  if(!rows.length)body.append(el('p',mode==='load'?'積載可能な陸軍が範囲内にいません。':'積荷はありません。'));
  const list=el('div');list.className='transport-list';body.append(list);
  for(const row of rows){
   const label=el('label'),input=el('input');input.type='checkbox';input.checked=checked.has(row.id);
   input.onchange=()=>{if(input.checked)checked.add(row.id);else checked.delete(row.id);update();};label.append(input,row.name);list.append(label);
  }
  const apply=el('button');apply.type='button';body.append(apply);
  function update(){
   apply.textContent=`${({load:'積載',transfer:'移送',unload:'荷下ろし'})[mode]}（${checked.size}）`;
   apply.disabled=busy||!options.active||scene.turn.phaseId!=='special'||!checked.size||mode==='transfer'&&!receiverId;
  }
  update();if(scene.turn.phaseId!=='special')body.append(el('small','輸送操作は特殊段階'));
  apply.onclick=async()=>{busy=true;update();try{await store.operateTransport({operation:mode,hostId:host.instanceId,receiverId,unitIds:[...checked]});checked.clear();message.textContent='輸送を完了しました。';}catch(error){message.textContent=error.message;}finally{busy=false;sync();}};
 }
 const unsubscribe=store.subscribe(sync);sync();return ()=>{unsubscribe();panel.remove();};
}
