import {generateTerrainTask} from './terrain-generation-task.js';
import {applyBrush,resizeTerrain} from './terrain-data.js';
import {beginTerrainEdit} from './terrain-edit-history.js';
import {settleAttackPhase} from './simulation-settlement.js';
import {finishSpecialPhase,finishTurn} from './simulation-phase-finish.js';
import {resolveMovementScene} from './simulation-features.js';
const strokes=new Map();
export function executeBackgroundTask(task,payload){
 if(task==='terrain-generate')return generateTerrainTask(payload);
 if(task==='terrain-resize')return resizeTerrain(payload.source,payload.settings);
 if(task==='terrain-start'){
  if(strokes.has(payload.sessionId))throw new Error('描画処理が重複しています。');
  const edit=beginTerrainEdit(payload.source);
  applyBrush(edit.working,{x:100000,y:100000},payload.brush);
  strokes.set(payload.sessionId,{edit,brush:payload.brush});return null;
 }
 if(task==='terrain-end'||task==='terrain-cancel'){strokes.delete(payload.sessionId);return null}
 if(task==='terrain-dabs'){
  const stroke=strokes.get(payload.sessionId);if(!stroke)throw new Error('描画セッションが見つかりません。描画をやり直してください。');
  for(const point of payload.points)applyBrush(stroke.edit.working,point,stroke.brush);
  return {changes:stroke.edit.drain()};
 }
 if(task==='simulation'){
  const scene=payload.scene;let receipt;
  switch(payload.operation){
   case 'movement':resolveMovementScene(scene);break;
   case 'attack':receipt=settleAttackPhase(scene);break;
   case 'special':receipt=finishSpecialPhase(scene);break;
   case 'turn-end':receipt=finishTurn(scene);break;
   default:throw new Error('未対応の推演処理です。');
  }
  // Immutable map/deployment history never comes back as replacement state.
  const {terrain,initialScene,...fields}=scene;
  return {fields,receipt};
 }
 throw new Error('未対応のバックグラウンド処理です。');
}
