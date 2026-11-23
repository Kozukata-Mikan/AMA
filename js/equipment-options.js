// 原生分组选择：武器和支援装备各自成栏，不改变装备ID。
export function fillEquipmentOptions(control,equipment,selected,label=item=>item.name){
 control.replaceChildren();
 for(const [kind,name] of [['weapon','武器'],['support','支援装備']]){
  const entries=equipment.filter(item=>item.kind===kind);if(!entries.length)continue;
  const group=document.createElement('optgroup');group.label=name;
  for(const item of entries)group.append(new Option(label(item),item.id));control.append(group);
 }
 if(equipment.some(item=>item.id===selected))control.value=selected;
 return control;
}
export function normalizeAviationComplement(value=[]){
 if(!Array.isArray(value)||value.length>1000)throw new Error('搭載航空機は1000種類以内で指定してください。');
 return value.map(entry=>{if(!entry||typeof entry.unitId!=='string'||!entry.unitId||!Number.isSafeInteger(entry.count)||entry.count<1||entry.count>10000)throw new Error('搭載航空機の種類・機数が不正です。');if(entry.groupId!==undefined&&entry.groupId!==null&&typeof entry.groupId!=='string')throw new Error('航空編隊名が不正です。');return{unitId:entry.unitId,count:entry.count,groupId:entry.groupId?.trim()||null};});
}
