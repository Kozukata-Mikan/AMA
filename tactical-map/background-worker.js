import {executeBackgroundTask} from './background-tasks.js?v=building-foundations-2';
self.onmessage=async event=>{
 const {id,task,payload}=event.data;
 try{self.postMessage({id,result:await executeBackgroundTask(task,payload)})}
 catch(error){self.postMessage({id,error:{name:error.name,message:error.message}})}
};
