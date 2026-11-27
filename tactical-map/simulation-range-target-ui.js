import {blastRadius} from './blast-area.js?v=self-sealing-1';
import {manualPasEnabled} from './pas-control.js?v=day-catalog-pas-1';
import {AIR_ATTACK_MODES,airAttackModes,airborneUnit} from './air-ground-rules.js?v=car-return-1';
import {
  readRangeCommandTarget
} from "./simulation-range-command.js?v=self-sealing-1";

import {
  readWeaponTargetScope
} from "./weapon-profile-runtime.js?v=self-sealing-1";


function fail(message) {
  throw new Error(message);
}

function validId(value) {
  return typeof value === "string" && value.trim() !== "";
}

function checkOptions(options) {
  if (!Array.isArray(options)) {
    fail("表示可能な対象一覧が不正です。");
  }

  const keys = new Set();

  for (const option of options) {
    const ref = option?.targetRef;

    if (
      !ref ||
      !["unit", "group"].includes(ref.kind) ||
      !validId(ref.id) ||
      typeof option.label !== "string" ||
      !Array.isArray(option.members)
    ) {
      fail("表示可能な対象の形式が不正です。");
    }

    const key = JSON.stringify([ref.kind, ref.id]);

    if (keys.has(key)) {
      fail("表示対象が重複しています。");
    }

    keys.add(key);

    const ids = new Set();

    for (const member of option.members) {
      if (
        !validId(member?.id) ||
        typeof member.label !== "string" ||
        ids.has(member.id)
      ) {
        fail("表示可能な編隊メンバーが不正です。");
      }

      ids.add(member.id);
    }

    if (
      ref.kind === "unit" &&
      (
        option.members.length !== 1 ||
        option.members[0].id !== ref.id
      )
    ) {
      fail("単体目標とメンバー一覧が一致しません。");
    }
  }
}

/**
 * optionsは観測権限で許可された情報だけを渡す。
 *
 * [
 *   {
 *     targetRef: { kind: "group", id: "..." },
 *     label: "表示名",
 *     members: [{ id: "...", label: "表示名" }]
 *   }
 * ]
 *
 * membersは界面で選択可能な候補。
 * 正式な射距・地形・被害資格は結算時に再検査する。
 *
 * 戻り値：
 *   element  : 既存の攻撃草案画面へ追加するDOM
 *   read()   : 保存時に読む選択値
 *   setDisabled(bool)
 *
 * このUI自体は保存、乱数、扣弾、射線登録を行わない。
 */
export function createRangeTargetEditor({options,scope,initial=null,penetration=null,coordinateMembers=[]}) {
  checkOptions(options);
  if(!scope||!['all','specified','random'].includes(scope.mode)||(scope.mode==='all'?scope.maximumTargets!==null:!Number.isSafeInteger(scope.maximumTargets)||scope.maximumTargets<1))fail('装備の範囲定義が不正です。');
  const radius=penetration===null?null:blastRadius(penetration);
  const node=(tag,text='')=>{const el=document.createElement(tag);el.textContent=text;return el;};
  const root=node('fieldset');root.className='simulation-range-target';root.append(node('legend','範囲攻撃の目標'));
  const labeled=(title,el)=>{const label=node('label');label.append(node('span',title),el);return label;};
  const mode=node('select');mode.append(new Option('編隊・集群を狙う','group'),new Option('爆心の座標を入力','point'));root.append(labeled('照準方法',mode));
  const select=node('select');select.append(new Option('選択してください',''),...options.map((o,i)=>new Option(o.label,String(i))));const groupLabel=labeled('目標の編隊・集群',select);root.append(groupLabel);
  const coordinates=node('div');coordinates.className='blast-coordinate-fields';const inputs={};for(const axis of ['x','y','z']){const input=node('input');input.type='number';input.step='any';input.value=axis==='z'?'0':'';inputs[axis]=input;coordinates.append(labeled('爆心 '+axis.toUpperCase(),input));}root.append(coordinates,node('p','Zは海面0、上空は正、水中は負の値です。'));
  const summary=node('p');summary.className='blast-summary';root.append(summary);
  const rule=scope.mode==='all'?'範囲内の全対象へそれぞれ完全投射。':scope.mode==='specified'?`識別済みの対象を最大${scope.maximumTargets}体まで指定。`:`範囲内から最大${scope.maximumTargets}回抽選。同じ対象の重複当選があります。`;
  root.append(node('p',(radius===null?'':`爆発半径 ${radius}マス（高さ・深さを含む球形）。`)+rule+' 弾薬は1回分です。友軍も巻き込みます。未識別の対象は表示しません。'));
  const membersBox=node('div'),errorBox=node('p');errorBox.setAttribute('role','alert');root.append(membersBox,errorBox);let checks=[],requiresReselection=false;
  const option=()=>select.value===''?null:options[Number(select.value)];
  function ref(){if(mode.value==='point'){if(Object.values(inputs).some(i=>!i.value.trim()||!Number.isFinite(Number(i.value))))fail('爆心のX・Y・Zを入力してください。');return{kind:'point',...Object.fromEntries(Object.entries(inputs).map(([k,i])=>[k,Number(i.value)]))};}if(!option())fail('目標の編隊・集群を選択してください。');return{...option().targetRef};}
  function renderMembers(selectedIds=checks.filter(c=>c.checked).map(c=>c.value)){
    groupLabel.hidden=mode.value==='point';coordinates.hidden=mode.value!=='point';membersBox.replaceChildren();checks=[];errorBox.textContent='';
    let center;try{const r=ref();center=r.kind==='point'?r:option()?.center;}catch{summary.textContent='照準方法と爆心を指定してください。';return;}
    summary.textContent=center?`爆心 X ${center.x.toFixed(2)} / Y ${center.y.toFixed(2)} / Z ${center.z.toFixed(2)}`:'編隊・集群を主目標にします。';
    if(scope.mode!=='specified')return;
    let members=coordinateMembers.length?coordinateMembers:option()?.members??[];
    if(center&&radius!==null)members=members.filter(m=>m.point&&Math.hypot(m.point.x-center.x,m.point.y-center.y,m.point.z-center.z)<=radius+1e-7);
    for(const m of members){const checkbox=node('input');checkbox.type='checkbox';checkbox.value=m.id;checkbox.checked=selectedIds.includes(m.id);checkbox.addEventListener('change',()=>{if(checks.filter(c=>c.checked).length>scope.maximumTargets){checkbox.checked=false;errorBox.textContent=`指定できるのは最大${scope.maximumTargets}体です。`;}else errorBox.textContent='';});checks.push(checkbox);membersBox.append(labeled(m.label,checkbox));}
    if(!members.length)membersBox.append(node('p','表示できる指定対象がありません。全体・ランダムの候補数は表示しません。'));
  }
  for(const control of [mode,select,...Object.values(inputs)])control.addEventListener('change',()=>{requiresReselection=false;renderMembers();});
  for(const input of Object.values(inputs))input.addEventListener('input',()=>{requiresReselection=false;renderMembers();});
  if(initial){const saved=readRangeCommandTarget(initial,scope);if(saved.targetRef.kind==='point'){mode.value='point';for(const k of ['x','y','z'])inputs[k].value=String(saved.targetRef[k]);renderMembers(saved.specifiedTargetIds);}else{const index=options.findIndex(o=>o.targetRef.kind===saved.targetRef.kind&&o.targetRef.id===saved.targetRef.id);if(index>=0){select.value=String(index);renderMembers(saved.specifiedTargetIds);}else requiresReselection=true;}
    if(saved.specifiedTargetIds.some(id=>!checks.some(c=>c.value===id))){requiresReselection=true;for(const c of checks)c.checked=false;}
  }else renderMembers();
  if(requiresReselection)errorBox.textContent='以前の目標を表示できません。目標を再指定してください。';
  return{element:root,read(){if(requiresReselection)fail('目標を再指定してください。');return readRangeCommandTarget({targetRef:ref(),specifiedTargetIds:scope.mode==='specified'?checks.filter(c=>c.checked).map(c=>c.value):[]},scope);},setDisabled(value){root.disabled=Boolean(value);}};
}

/**
 * 正式范围攻击面板：
 * 使用store原事务保存，不直接调用内部结算函数。
 *
 * store.mountRangeAttackPanel(container, unitId)是挂载入口。
 * dispose()移除订阅及面板。
 */
export function createRangeAttackPanel({ store, unitId }) {
  const root = document.createElement("section");
  root.className = "simulation-range-attack-panel";

  const heading = document.createElement("h3");
  heading.textContent = "範囲攻撃計画";

  const body = document.createElement("div");
  const message = document.createElement("p");
  message.setAttribute("role", "status");

  const method=document.createElement("select"),methodLabel=document.createElement("label"),methodTitle=document.createElement("span");methodTitle.textContent="対地・対艦攻撃方式";methodLabel.append(methodTitle,method);
  root.append(heading,methodLabel,body,message);

  let disposed = false;

  function render() {
    if (disposed) return;

    body.replaceChildren();

    try {
      const currentScene=store.getSceneSnapshot(),unit=currentScene.instances.find(u=>u.instanceId===unitId),oldMethod=method.value;methodLabel.hidden=!airborneUnit(unit);method.replaceChildren(new Option("攻撃方式を選択",""),...AIR_ATTACK_MODES.filter(m=>airAttackModes(unit).includes(m[0])).map(m=>new Option(m[1],m[0])));if([...method.options].some(o=>o.value===oldMethod))method.value=oldMethod;
      const report = store.getAttackGroupReport(unitId);
      const targets = store.getRangeAttackTargetOptions(unitId);
      const plans = store.getAttackCommands(unitId);

      if (
        report.revision !== targets.revision ||
        report.revision !== plans.revision
      ) {
        throw new Error("状態が変更されています。再表示してください。");
      }

      let count = 0;

      for (const group of report.groups) {
        if (group.profile?.kind !== "weapon" || group.profile?.pasOnly&&!manualPasEnabled(currentScene,unit?.side)) continue;

        let scope;

        try {
          scope = readWeaponTargetScope(
            group.profile.targetScope
          );
        } catch (error) {
          const warning = document.createElement("p");
          warning.textContent =
            `${group.label}：${error.message}`;
          body.append(warning);
          continue;
        }

        if (scope.kind !== "range") continue;
        count++;

        const box = document.createElement("section");
        const title = document.createElement("h4");
        title.textContent =
          `${group.label}／${group.position}／第${group.groupIndex + 1}組`;


        const current = plans.commands.find(
          command => command.groupId === group.groupId
        );

        const editor = createRangeTargetEditor({
          options: targets.options,
          coordinateMembers:targets.coordinateMembers,
          penetration:group.profile.penetration,
          scope,
          initial: current?.targetRef ? current : null
        });

        const warning = document.createElement("p");

        if (current?.requiresReselection) {
          warning.textContent =
            "以前の対象を表示できません。主目標と対象を再指定してください。";
        } else if (group.issues.length) {
          warning.textContent = group.issues.join("\n");
        }

        const save = document.createElement("button");
        save.type = "button";
        save.textContent = "この装備組の計画を保存";
        save.disabled = group.issues.length > 0;
        editor.setDisabled(save.disabled);

        save.addEventListener("click", async () => {
          try {
            const selection = editor.read();

            await store.saveAttackCommands({
              unitId,
              attackMethod:method.value||null,
              assignments: [{
                groupId: group.groupId,
                ...selection
              }]
            }, report.revision);

            message.textContent =
              "攻撃計画を保存しました。抽選・命中・弾薬消費はまだ実行していません。";
          } catch (error) {
            message.textContent = error.message;
          }
        });

        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "この装備組の計画を取消";
        cancel.disabled = !current;

        cancel.addEventListener("click", async () => {
          try {
            await store.cancelAttackCommands({
              unitId,
              groupIds: [group.groupId]
            }, report.revision);

            message.textContent = "攻撃計画を取り消しました。";
          } catch (error) {
            message.textContent = error.message;
          }
        });

        box.append(
          title,
          warning,
          editor.element,
          save,
          cancel
        );

        body.append(box);
      }

      if (count === 0) {
        const note = document.createElement("p");
        note.textContent =
          "正式に解釈できる範囲武器がありません。";
        body.append(note);
      }
    } catch (error) {
      message.textContent = error.message;
    }
  }

  const unsubscribe = store.subscribe(render);
  render();

  return {
    element: root,

    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      root.remove();
    }
  };
}
