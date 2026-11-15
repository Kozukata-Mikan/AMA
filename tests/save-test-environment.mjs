import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {closeSaveDatabase} from '../js/save-database.js';
export {IDBObjectStore};
export async function resetDatabase(){await closeSaveDatabase();globalThis.indexedDB=new IDBFactory();globalThis.BroadcastChannel=undefined}
