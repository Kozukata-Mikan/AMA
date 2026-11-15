// Durable local saves. Legacy localStorage payloads are read-only migration backups.
const DB_NAME = 'ama-local-saves';
const RECORDS = 'records';
const INDEX = 'save-index';
const SIGNAL = 'ama-local-saves:changed';
let opening = null;
let generation = 0;
const watchers = new Set();
let channel = null;
let listening = false;

export class SaveConflictError extends Error {
  constructor(){super('別の画面で保存データが更新されています。再読み込みしてから再試行してください。');this.name='SaveConflictError'}
}
function database() {
  if (opening) return opening;
  opening = new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error('IndexedDBを利用できません。ブラウザーの保存設定を確認してください。旧保存データは変更していません。'));return}
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(RECORDS))db.createObjectStore(RECORDS,{keyPath:'key'});
      if(!db.objectStoreNames.contains(INDEX))db.createObjectStore(INDEX,{keyPath:'key'});
    };
    let blocked = false;
    request.onblocked=()=>{blocked=true;reject(new Error('保存データベースを開けません。他の古いタブを閉じて再試行してください。'))};
    request.onerror=()=>reject(request.error??new Error('保存データベースを開けません。'));
    request.onsuccess=()=>{
      const db=request.result;
      if(blocked){db.close();return}
      db.onversionchange=()=>{db.close();opening=null};
      resolve(db);
    };
  }).catch(error=>{opening=null;throw error});
  return opening;
}
async function transaction(mode,run) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    let tx;
    try{tx=db.transaction([RECORDS,INDEX],mode,mode==='readwrite'?{durability:'strict'}:undefined)}catch(error){reject(error);return}
    let result,error;
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(error??tx.error??new Error('保存を完了できませんでした。変更は確定していません。'));
    tx.onerror=()=>{};
    const abort=reason=>{error=reason;try{tx.abort()}catch{reject(reason)}};
    try{run(tx.objectStore(RECORDS),tx.objectStore(INDEX),value=>{result=value},abort)}catch(reason){abort(reason)}
  });
}
function metadata(key,raw,name) {
  if(name===undefined){try{name=JSON.parse(raw).name}catch{name=key}}
  return {key,name:typeof name==='string'?name:key,updatedAt:new Date().toISOString()};
}
function notifyRemote(key) {
  const signal={key,generation:++generation,time:Date.now()};
  try{channel?.postMessage(signal)}catch{}
  // Only tiny notification metadata goes to localStorage; never a full save.
  try{globalThis.localStorage?.setItem(SIGNAL,JSON.stringify(signal))}catch{}
}
function receive(signal) {
  if(typeof signal?.key!=='string')return;
  for(const listener of watchers)Promise.resolve().then(()=>listener(signal.key)).catch(console.error);
}
export function subscribeSaveChanges(listener) {
  watchers.add(listener);
  if(!listening && globalThis.window){
    listening=true;
    if(globalThis.BroadcastChannel){channel=new BroadcastChannel(SIGNAL);channel.onmessage=event=>receive(event.data);channel.unref?.()}
    window.addEventListener('storage',event=>{if(event.key===SIGNAL){try{receive(JSON.parse(event.newValue))}catch{}}});
  }
  return ()=>watchers.delete(listener);
}

export async function readSave(key) {
  const existing=await transaction('readonly',(records,index,done)=>{const r=records.get(key);r.onsuccess=()=>done(r.result?.raw??null)});
  if(existing!==null)return existing;
  // Legacy values are never removed or rewritten, even after a successful import.
  const legacy=globalThis.localStorage?.getItem(key)??null;
  if(legacy===null)return null;
  return transaction('readwrite',(records,index,done,abort)=>{
    const request=records.get(key);
    request.onsuccess=()=>{
      try {
        if(request.result){done(request.result.raw);return}
        records.put({key,raw:legacy});index.put(metadata(key,legacy));done(legacy);
      } catch(error) { abort(error); }
    };
  });
}

export async function writeSave(key,raw,{expectedRaw=null,name}={}) {
  if(typeof raw!=='string')throw new TypeError('保存データは文字列で指定してください。');
  await transaction('readwrite',(records,index,done,abort)=>{
    const request=records.get(key);
    request.onsuccess=()=>{
      try {
        if((request.result?.raw??null)!==expectedRaw){abort(new SaveConflictError());return}
        records.put({key,raw});index.put(metadata(key,raw,name));done(raw);
      } catch(error) { abort(error); }
    };
  });
  notifyRemote(key);
  return raw;
}

export async function listSaveMetadata(prefix) {
  // Import legacy keys lazily, without overwriting an existing IndexedDB record.
  const legacyKeys=[];
  for(let i=0;i<(globalThis.localStorage?.length??0);i++){
    const key=localStorage.key(i);if(key?.startsWith(prefix))legacyKeys.push(key);
  }
  for(const key of legacyKeys)await readSave(key);
  const entries=await transaction('readonly',(records,index,done)=>{const r=index.getAll();r.onsuccess=()=>done(r.result)});
  return entries.filter(entry=>entry.key.startsWith(prefix));
}

// Close connections cleanly for maintenance/version upgrades (also used by tests).
export async function closeSaveDatabase() {
  const current=opening; opening=null;
  if(current){try{(await current).close()}catch{}}
}
