import {supportGroups} from './electronic-warfare.js?v=visual-support-bridge-1';
const el=(tag,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
export function mountElectronicWarfareUI(store){
 const panel=el('details');panel.dataset.workflowPanel='electronic-warfare';panel.dataset.toolCategory='progress';panel.append(el('summary','電子戦・フレア'));
 panel.append(el('p','電子戦ポッド1組＝5点、水平半径750マス。開始・特殊段階に各組の攻撃／防御を選びます。同ラウンドの再切替は不可。未設定は防御です。移動段階に入ると、その設定で本ラウンドを固定します。20点差で偵察無効・強ロック、30でレーダー50%・無人機攻撃不能、40で無人機喪失、50で敵の探測難度E。通常の必見距離は維持します。'));
 const select=el('select'),label=el('label'),body=el('div'),message=el('p');message.setAttribute('role','status');label.append(el('span','自陣営の電子装備'),select);panel.append(label,body,message);document.querySelector('aside').append(panel);
 let scene;
 async function perform(action){try{await action();message.textContent='電子装備の設定を保存しました。';}catch(e){message.textContent=e.message;}}
 function renderBody(){body.replaceChildren();const u=scene.instances.find(u=>u.instanceId===select.value);if(!u)return;body.append(el('p',`受けている電子圧制：${u.electronicState?.margin??0}点差${u.electronicState?.strongLock?' / 強ロック中':''}`));
  for(const g of supportGroups(u,'electronic-warfare-pod')){const mode=el('select');mode.append(new Option('電子防御 5点','defense'),new Option('電子干渉 5点','attack'));mode.value=g.electronicMode??'defense';mode.disabled=!['start','special'].includes(scene.turn.phaseId)||g.electronicChoiceTurn===scene.turn.number;const l=el('label');l.append(el('span',`${g.position} / 第${g.groupIndex+1}組`),mode);mode.addEventListener('change',()=>perform(()=>store.setElectronicMode({unitId:u.instanceId,groupId:g.id,mode:mode.value})));body.append(l);}
  if((u.snapshot.equipmentSnapshots??[]).some(e=>e.supportEffect==='flare')){const checkbox=el('input');checkbox.type='checkbox';checkbox.checked=u.flareAutoEnabled!==false;const l=el('label');l.append(checkbox,el('span',`フレアを自動使用（残り${supportGroups(u,'flare').length}組）`));checkbox.addEventListener('change',()=>perform(()=>store.setFlareAuto({unitId:u.instanceId,enabled:checkbox.checked})));body.append(l,el('p','1ラウンド1回、1組消費。発動した次序内のレーダー・数値制御攻撃を全て無効化します。強ロック中は発動しません。'));}
 }
 function sync(){scene=store.getSceneSnapshot();const old=select.value,side=scene.controls.enemyAutonomy?'ally':scene.controls.observationSide??'ally';select.replaceChildren(new Option('ユニットを選択',''),...scene.instances.filter(u=>u.side===side&&(u.snapshot?.equipmentSnapshots??[]).some(e=>['electronic-warfare-pod','flare'].includes(e.supportEffect))).map(u=>new Option(u.name,u.instanceId)));if([...select.options].some(o=>o.value===old))select.value=old;renderBody();}select.addEventListener('change',renderBody);const unsubscribe=store.subscribe(sync);sync();return()=>{unsubscribe();panel.remove();};
}
export function drawBallisticOverlay(parent,scene,project){
 const svg=(tag,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);parent.append(e);return e;};
 for(const u of scene.instances){const p=u.projectileState;if(p?.status!=='flying'||u.observationLevel==='shadow')continue;const a=project(u.x,u.y,u.altitude),b=project(p.center.x,p.center.y,p.center.z),start=p.launchPoint?project(p.launchPoint.x,p.launchPoint.y,p.launchPoint.z):null;
  if(start)svg('path',{d:`M ${start.x} ${start.y} Q ${a.x} ${a.y-30} ${b.x} ${b.y}`,fill:'none',stroke:u.side==='enemy'?'#ffae72':'#c3a8ff','stroke-dasharray':'6 5','pointer-events':'none',opacity:.6});
  svg('circle',{cx:b.x,cy:b.y,r:9,fill:'none',stroke:'#f4afef','stroke-width':2,'pointer-events':'none'});svg('path',{d:`M ${b.x-13} ${b.y} h 26 M ${b.x} ${b.y-13} v 26`,stroke:'#f4afef','pointer-events':'none'});const text=svg('text',{x:b.x+15,y:b.y-10,fill:'#f4afef','font-size':11,'pointer-events':'none'});text.textContent=`着弾 R${p.dueTurn} ${p.duePhase==='pas'?'PAS':'次序'+p.duePhase.slice(6)}`;
 }
}
