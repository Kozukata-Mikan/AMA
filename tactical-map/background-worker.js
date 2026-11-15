import {executeBackgroundTask} from './background-tasks.js';
self.onmessage=event=>{
 const {id,task,payload}=event.data;
 try{self.postMessage({id,result:executeBackgroundTask(task,payload)})}
 catch(error){self.postMessage({id,error:{name:error.name,message:error.message}})}
};
