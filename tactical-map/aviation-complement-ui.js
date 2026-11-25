const node=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
export function mountAviationComplementEditor(parent,units,value=[]){
 const host=node('fieldset');host.className='catalog-section';host.append(node('legend','搭載航空機（航空運用）'),node('p','航空機テンプレートと機数を登録します。駐機枠は発動機数×機数で消費します。整備には整備区が必要です。起降には滑走路、またはRATO搭載機用のカタパルトを使用します。水上機は滑走路不要で水面から起降できます。'));
 const list=node('div'),readers=[],templates=units.filter(u=>u.branch==='air'&&u.aircraft?.version===1);host.append(list);
 function add(value={unitId:templates[0]?.id??'',count:1,groupId:null}){
  const row=node('div');row.className='catalog-repeat-row';const field=(title,control)=>{const label=node('label');label.className='catalog-field';label.append(node('span',title),control);row.append(label);return control;};
  const types=field('機体テンプレート',node('select'));for(const u of templates)types.append(new Option(u.name,u.id));types.value=value.unitId;
  const count=field('搭載機数',node('input'));count.type='number';count.min='1';count.step='1';count.value=value.count;
  const group=field('航空編隊名（空欄＝編隊なし）',node('input'));group.value=value.groupId??'';
  const reader={active:true,read:()=>({unitId:types.value,count:Number(count.value),groupId:group.value.trim()||null})};readers.push(reader);
  const remove=node('button','この搭載設定を削除');remove.type='button';remove.addEventListener('click',()=>{reader.active=false;row.remove();});row.append(remove);list.append(row);
 }
 if(!templates.length)host.append(node('p','使用可能な航空機テンプレートがありません。航空機図鑑で機体を新規登録するか、旧形式の機体を編集・保存してから戻ってください。'));
 for(const row of value)add(row);const button=node('button','搭載航空機を追加');button.type='button';button.disabled=!templates.length;button.addEventListener('click',()=>add());host.append(button);parent.append(host);return()=>readers.filter(r=>r.active).map(r=>r.read());
}
