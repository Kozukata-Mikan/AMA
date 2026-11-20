import {planFormationAttack} from "./simulation-formation-attack.js?v=catalog-layout-2";
import {buildObservedRoundReports, captureRoundWitnesses} from "./simulation-round-report.js?v=catalog-layout-2";
import {encodeSpecialHistory,decodeSpecialHistory} from './special-history-codec.js';
import {freezeSpecialHistory} from './special-history-snapshot.js';
import {generateTerrainTask} from './terrain-generation-task.js';
import {applyBrush,resizeTerrain} from './terrain-data.js';
import {beginTerrainEdit} from './terrain-edit-history.js';
import {settleAttackPhase,prepareSettlementAttackPlan} from './simulation-settlement.js?v=catalog-layout-2';
import {finishSpecialPhase,finishTurn} from './simulation-phase-finish.js?v=catalog-layout-2';
import {resolveMovementScene} from './simulation-features.js?v=catalog-layout-2';
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
 if(task==='simulation-attack-preflight'){
  const scene=freezeSpecialHistory(decodeSpecialHistory(payload.scene));
  prepareSettlementAttackPlan(scene);
  return {validated:true};
 }
 if(task==='simulation'){
  const scene=freezeSpecialHistory(decodeSpecialHistory(payload.scene));let receipt;
  let roundObservation;
  switch(payload.operation){
   case 'movement': {
    resolveMovementScene(scene);
    const movement = scene.movementRuntime?.records.at(-1);
    if (!scene.controls.enemyAutonomy && movement?.collisions.length) {
      movement.roundWitnesses = captureRoundWitnesses(scene, movement.collisions.map(event => event.unitIds));
    }
    break;
   }
   case 'attack':receipt=settleAttackPhase(scene);break;
   case 'formation-attack':receipt=planFormationAttack(scene,payload.request);break;
   case 'special':receipt=finishSpecialPhase(scene);break;
   case 'turn-end': {
    const roundNumber = scene.turn.number;
    receipt = finishTurn(scene);
    if (!scene.controls.enemyAutonomy) roundObservation = buildObservedRoundReports(scene, roundNumber);
    break;
   }
   default:throw new Error('未対応の推演処理です。');
  }
  // Immutable map/deployment history never comes back as replacement state.
  const {terrain,initialScene,...fields}=scene;
  return {fields:encodeSpecialHistory(fields),receipt,roundObservation};
 }
 throw new Error('未対応のバックグラウンド処理です。');
}
