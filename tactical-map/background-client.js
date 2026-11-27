import {deserializeBackgroundError} from './background-errors.js?v=settlement-audit-1';
let worker=null,nextId=0;
const pending=new Map(),listeners=new Set();
function announce(){for(const listener of listeners){try{listener(pending.size)}catch(error){console.error(error)}}}
export function subscribeBackgroundStatus(listener){listeners.add(listener);listener(pending.size);return()=>listeners.delete(listener)}
function failWorker(error){
 worker?.terminate();worker=null;
 for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(error)}
 pending.clear();announce();
}
function getWorker(){
 if(worker)return worker;
 worker=new Worker(new URL('./background-worker.js?v=visual-support-bridge-1',import.meta.url),{type:'module'});
 worker.onmessage=event=>{
  const message=event.data,entry=pending.get(message.id);if(!entry)return;
  pending.delete(message.id);clearTimeout(entry.timer);
  if(message.error){entry.reject(deserializeBackgroundError(message.error))}else entry.resolve(message.result);
  announce();
 };
 worker.onerror=event=>{event.preventDefault?.();failWorker(new Error('バックグラウンド計算に失敗しました。結果は保存していません。'))};
 worker.onmessageerror=()=>failWorker(new Error('計算結果を読み込めませんでした。結果は保存していません。'));
 return worker;
}
export async function runBackgroundTask(task,payload){
 if(typeof globalThis.Worker!=='function'){
  // Compatibility path only: never rerun a failed worker/random calculation here.
  await new Promise(resolve=>setTimeout(resolve,0));
  const {executeBackgroundTask}=await import('./background-tasks.js?v=visual-support-bridge-1');
  return executeBackgroundTask(task,payload);
 }
 let active;
 try{active=getWorker()}catch(error){throw new Error('計算用ワーカーを起動できませんでした。変更は保存していません。',{cause:error})}
 return new Promise((resolve,reject)=>{
  const id=++nextId;
  const timer=setTimeout(()=>failWorker(new Error('計算が時間内に完了しませんでした。結果は保存していません。')),180000);
  pending.set(id,{resolve,reject,timer});announce();
  try{active.postMessage({id,task,payload})}catch(error){pending.delete(id);clearTimeout(timer);announce();reject(error)}
 });
}
export function shutdownBackground(){failWorker(new Error('バックグラウンド計算を終了しました。'))}
