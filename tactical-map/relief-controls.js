import {VERTICAL_EXAGGERATIONS,getVerticalExaggeration,setVerticalExaggeration} from './relief-display.js';
export const RELIEF_PREFERENCE_KEY='ama-display-vertical-exaggeration-v1';
export function mountReliefControls(container,{onChange=()=>{},canChange=()=>true}={}){
 let initial=5;try{const saved=localStorage.getItem(RELIEF_PREFERENCE_KEY);if(saved!==null&&VERTICAL_EXAGGERATIONS.includes(Number(saved)))initial=Number(saved)}catch{}
 setVerticalExaggeration(initial);
 const label=document.createElement('label');label.className='relief-control';
 const title=document.createElement('span');title.textContent='地形の高さ（表示）';
 const select=document.createElement('select');select.setAttribute('aria-label','垂直誇張倍率（表示のみ）');
 for(const value of VERTICAL_EXAGGERATIONS){const option=document.createElement('option');option.value=String(value);option.textContent=value===1?'1倍（実高度）':`${value}倍`;select.append(option)}select.value=String(initial);
 const note=document.createElement('small');note.textContent='表示のみ・Z数値と計算は実高度';note.setAttribute('role','status');
 label.append(title,select,note);container.append(label);
 function change(){const previous=getVerticalExaggeration();try{
  if(!canChange())throw new Error('描画・配置・地形計算の完了後に変更してください。');
  setVerticalExaggeration(select.value);onChange();
  try{localStorage.setItem(RELIEF_PREFERENCE_KEY,String(getVerticalExaggeration()))}catch{}
  note.textContent='表示のみ・Z数値と計算は実高度';
 }catch(error){setVerticalExaggeration(previous);select.value=String(previous);note.textContent=error.message}}
 select.addEventListener('change',change);
 return ()=>{select.removeEventListener('change',change);label.remove()};
}
