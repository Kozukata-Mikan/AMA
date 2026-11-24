import {executeBackgroundTask} from './background-tasks.js?v=air-combat-2';
self.onmessage=async event=>{
 const {id,task,payload}=event.data;
 try{self.postMessage({id,result:await executeBackgroundTask(task,payload)})}
 catch(error){self.postMessage({id,error:{name:error.name,message:error.message}})}
};
