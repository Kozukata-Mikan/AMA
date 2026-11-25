// Explicit diagnostic envelope: Error.cause and custom fields are otherwise lost
// when the worker sends only name/message. Never copy arbitrary scene objects.
const text=(value,limit=16000)=>typeof value==='string'?value.slice(0,limit):undefined;
export function serializeBackgroundError(error,seen=new Set(),depth=0){
 if(depth>=8||seen.has(error))return{name:'Error',message:'原因の連鎖を省略しました。'};
 if(error&&typeof error==='object')seen.add(error);
 const result={name:text(error?.name,200)??'Error',message:text(error?.message)??(typeof error==='string'?text(error):'計算中にエラーが発生しました。')};
 for(const key of ['stack','code','publicMessage']){const value=text(error?.[key]);if(value!==undefined)result[key]=value;}
 if(typeof error?.skipAttack==='boolean')result.skipAttack=error.skipAttack;
 if(error?.cause!==undefined)result.cause=serializeBackgroundError(error.cause,seen,depth+1);
 return result;
}
export function deserializeBackgroundError(value,depth=0){
 if(depth>=8)return new Error('原因の連鎖を省略しました。');
 const error=new Error(text(value?.message)??'計算中にエラーが発生しました。');
 error.name=text(value?.name,200)??'Error';
 for(const key of ['stack','code','publicMessage']){const item=text(value?.[key]);if(item!==undefined)error[key]=item;}
 if(typeof value?.skipAttack==='boolean')error.skipAttack=value.skipAttack;
 if(value?.cause&&typeof value.cause==='object')error.cause=deserializeBackgroundError(value.cause,depth+1);
 return error;
}
