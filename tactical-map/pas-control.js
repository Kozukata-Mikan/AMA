export const manualPasEnabled=(scene,side)=>scene.controls?.manualPasSides?.includes(side)===true;
export function validateManualPasSides(value=[]){if(!Array.isArray(value)||new Set(value).size!==value.length||value.some(s=>!['ally','enemy','neutral'].includes(s)))throw Error('手動PASの陣営設定が不正です。');return [...value];}
