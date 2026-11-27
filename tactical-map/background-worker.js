import {serializeBackgroundError} from './background-errors.js?v=settlement-audit-1';
import {executeBackgroundTask} from './background-tasks.js?v=aviation-deck-1';
self.onmessage=async event=>{
 const {id,task,payload}=event.data;
 try{self.postMessage({id,result:await executeBackgroundTask(task,payload)})}
 catch(error){self.postMessage({id,error:serializeBackgroundError(error)})}
};
