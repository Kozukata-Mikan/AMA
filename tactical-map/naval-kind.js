export const NAVAL_KINDS = [['air','空中艦'],['surface','水上艦'],['submarine','水中艦'],['land','陸上艦']];
export function normalizeNavalKind(value) {
  if (!NAVAL_KINDS.some(([id])=>id===value)) throw new Error('艦船の種類が不正です。');
  return value;
}
export function navalKind(unit) {
  const kind = unit.snapshot?.naval?.kind ?? unit.naval?.kind;
  return kind === undefined ? unit.underwater === true ? 'submarine' : 'surface' : normalizeNavalKind(kind);
}
export function isSubmerged(unit) {
  return unit.branch === 'navy' && navalKind(unit)==='submarine' && (unit.depth ?? 12)>0;
}
export function normalizeNavalPosition(unit) {
  if (unit.branch !== 'navy') return unit;
  const naval=unit.snapshot.naval;
  if (naval.surfaceSpeedKnots != null) {
    if (!Number.isFinite(naval.surfaceSpeedKnots) || naval.surfaceSpeedKnots<0) throw new Error('航速は0以上で指定してください。');
    naval.speedKnots=naval.surfaceSpeedKnots;
  }
  delete naval.surfaceSpeedKnots;
  const kind=navalKind(unit), legacy=naval.kind===undefined;
  unit.snapshot.naval.kind=kind;
  if (kind==='submarine') {
    const depth=unit.depth ?? (legacy && unit.underwater === true ? 12 : unit.underwater === false ? 0 : 1);
    if (!Number.isFinite(depth) || !(depth===0 || depth>=1)) throw new Error('水中艦の深度は0（水面）または1以上で指定してください。');
    unit.depth=depth;unit.underwater=depth>0;
  } else {
    unit.depth=0;unit.underwater=false;
  }
  if (kind==='air') {
    unit.altitude ??= 1;
    if (!Number.isFinite(unit.altitude)||unit.altitude<1)throw new Error('空中艦の高度は1以上で指定してください。');
  }
  return unit;
}
export function setNavalVertical(unit, value) {
  const kind=navalKind(unit);
  if (value.depth!==undefined) {
    if(kind!=='submarine')throw new Error('潜深を変更できるのは水中艦だけです。');
    unit.depth=value.depth;
  }
  if(value.altitude!==undefined) {
    if(kind!=='air')throw new Error('高度を変更できるのは空中艦だけです。');
    unit.altitude=value.altitude;
  }
  return normalizeNavalPosition(unit);
}
export function navalHeight(unit, sample) {
  return navalKind(unit)==='air' ? unit.altitude ?? 1 : isSubmerged(unit) ? -(unit.depth ?? 12) : navalKind(unit)==='land' ? sample.surface : 0;
}
export function navalCanTraverse(unit,sample) {
  if(!sample.inside)return false;
  const kind=navalKind(unit);
  if(kind==='air')return Number.isFinite(unit.altitude) && unit.altitude>=1 && unit.altitude>sample.height;
  if(kind==='land')return ['land','river','shallow'].includes(sample.kind);
  if(sample.kind==='land')return false;
  if(['river','shallow'].includes(sample.kind))return !isSubmerged(unit) && unit.sizeLevel<=2;
  return sample.kind==='sea';
}
export function navalPlacement(unit,sample) {
  try {
    const copy={...unit,snapshot:{...unit.snapshot,naval:{...unit.snapshot?.naval}}};
    normalizeNavalPosition(copy);
    if(!navalCanTraverse(copy,sample))return {valid:false,reason:'艦船の種類・現在の高度／深度では、この地形に配置できません。'};
    return {valid:true,height:navalHeight(copy,sample),ground:sample.surface,note:`${NAVAL_KINDS.find(([id])=>id===navalKind(copy))[1]} · ${isSubmerged(copy)?'深度 '+copy.depth:navalKind(copy)==='air'?'高度 '+copy.altitude:'高度 0'}`};
  }catch(error){return {valid:false,reason:error.message};}
}
