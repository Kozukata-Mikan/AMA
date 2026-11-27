import {AIR_ATTACK_MODES,airborneUnit,airAttackModes} from './air-ground-rules.js?v=car-return-1';
const node=(tag,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
export function createFlightMissionEditor(store,selected){
 const panel=node('fieldset'),kind=node('select'),behavior=node('select'),waypoints=node('textarea'),radius=node('input'),altitude=node('input'),target=node('select'),escort=node('select'),method=node('select'),status=node('p');
 panel.append(node('legend','離陸前の航路計画'));kind.append(...[['','手動航行'],['CAR','CAR｜空中戦術偵察'],['CAS','CAS｜空中戦術支援'],['CAP','CAP｜空中戦術巡邏']].map(([id,name])=>new Option(name,id)));
 const labels=new Map();for(const [title,c]of [['任務',kind],['行動方針',behavior],['航点（1行に X, Y）',waypoints],['起点からの巡航半径（マス）',radius],['巡航高度（高度単位）',altitude],['CASの攻撃目標',target],['護衛する飛行中のCAS攻撃隊',escort],['CASの攻撃方式',method]]){const l=node('label');l.append(node('span',title),c);panel.append(l);labels.set(c,l);}
 radius.type=altitude.type='number';radius.min='1';radius.value='50';altitude.min='1';altitude.value='10';waypoints.rows=4;waypoints.placeholder='100, 50\n150, 100';
 const note=node('p','CARは終点到達または滞空時間半分で帰投。終点到達後は残り移動距離があってもその場で停止し、次のラウンドから帰投します。CAPは残り1Rで帰投を開始し、間に合わなければ墜落します。CASは主動武器と選択掛載を使用します。帰投後の着陸は次のラウンド開始に自動登録し、通常の滑走路枠・駐機枠・時間制限を照合します。護衛は攻撃隊の100マス以内の識別済み敵機を迎撃します。手動移動計画がある機体は、そのラウンドの自動航行を休止します。');note.className='note';panel.append(note);
 const save=node('button','航路を保存'),clear=node('button','航路を解除');save.type=clear.type='button';status.setAttribute('role','status');panel.append(save,clear,status);
 const reset=(c,options)=>{const old=c.value;c.replaceChildren(...options.map(([id,name])=>new Option(name,id)));if(options.some(([id])=>id===old))c.value=old;};
 let lastSelection='';
 function sync(){const scene=store.getSceneSnapshot(),planes=selected(),p=planes[0],signature=planes.map(p=>p.instanceId).join('|'),saved=signature!==lastSelection?p?.aircraftState?.flightPlan:null;lastSelection=signature;if(saved){kind.value=saved.kind;waypoints.value=saved.waypoints.map(w=>`${w.x}, ${w.y}`).join('\n');radius.value=String(saved.radius);altitude.value=String(saved.altitude);}
  reset(behavior,({CAR:[['avoid','敵機遭遇で帰投'],['priority','任務優先']],CAS:[['adjust','攻撃方式を事前設定'],['escort','攻撃隊を護衛']],CAP:[['engage','積極交戦'],['conservative','保守巡航']]})[kind.value]??[]);if(saved)behavior.value=saved.behavior;
  reset(method,[['','攻撃方式を選択'],...AIR_ATTACK_MODES.filter(m=>airAttackModes(p).includes(m[0])).map(m=>[m[0],m[1]])]);
  reset(target,[['','攻撃目標を選択'],...scene.instances.filter(u=>!u.observationOwn&&u.observationLevel==='identified'&&!airborneUnit(u)&&u.currentHp!==0).map(u=>[u.instanceId,u.name]),...scene.groups.filter(g=>scene.instances.some(u=>u.groupId===g.id&&!u.observationOwn&&u.observationLevel==='identified'&&!airborneUnit(u))).map(g=>['group:'+g.id,'編隊：'+g.name])]);
  const groups=new Map();for(const u of scene.instances){const f=u.aircraftState?.flightPlan;if(!u.observationOwn||u.aircraftState?.mission!=='airborne'||f?.kind!=='CAS'||f.behavior==='escort')continue;const id=u.aircraftState.clusterId??u.instanceId;if(!groups.has(id))groups.set(id,[u.instanceId,scene.groups.find(g=>g.id===id)?.name??u.name]);}reset(escort,[['','護衛対象を選択'],...[...groups.values()]]);
  if(saved){target.value=saved.targetGroupId?'group:'+saved.targetGroupId:saved.targetId??'';escort.value=saved.escortId??'';method.value=saved.attackMethod??'';}
  for(const c of [behavior,altitude])labels.get(c).hidden=!kind.value;
  labels.get(waypoints).hidden=!['CAR','CAS'].includes(kind.value)||kind.value==='CAS'&&behavior.value==='escort';labels.get(radius).hidden=kind.value!=='CAP';labels.get(target).hidden=labels.get(method).hidden=kind.value!=='CAS'||behavior.value==='escort';labels.get(escort).hidden=kind.value!=='CAS'||behavior.value!=='escort';
  save.disabled=clear.disabled=scene.turn.phaseId!=='start'||!planes.length;
 }
 function request(){if(!kind.value)return null;const points=waypoints.value.trim()?waypoints.value.trim().split(/\r?\n/).map((line,i)=>{const values=line.trim().split(/[,，\s]+/);if(values.length!==2||values.some(v=>!v||!Number.isFinite(Number(v))))throw Error(`航点${i+1}は「X, Y」の形式で指定してください。`);return{x:Number(values[0]),y:Number(values[1])};}):[];return{kind:kind.value,behavior:behavior.value,waypoints:points,radius:Number(radius.value),altitude:Number(altitude.value),targetId:target.value,escortId:escort.value,attackMethod:method.value};}
 save.addEventListener('click',async()=>{try{await store.assignFlightMission({aircraftIds:selected().map(p=>p.instanceId),plan:request()});status.textContent='航路を保存しました。離陸を指示すると任務を開始します。';}catch(e){status.textContent=e.message;}});
 clear.addEventListener('click',async()=>{try{await store.assignFlightMission({aircraftIds:selected().map(p=>p.instanceId),plan:null});kind.value='';sync();status.textContent='航路を解除しました。';}catch(e){status.textContent=e.message;}});
 for(const c of [kind,behavior])c.addEventListener('change',sync);
 return{panel,sync,request};
}
