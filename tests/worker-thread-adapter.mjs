import {parentPort} from 'node:worker_threads';
globalThis.self={postMessage:data=>parentPort.postMessage(data)};
await import('../tactical-map/background-worker.js?v=air-exercises-1');
parentPort.on('message',data=>self.onmessage({data}));
