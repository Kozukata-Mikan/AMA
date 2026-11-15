// Display-only state. No terrain, scene, save, LOS or combat modules depend on it.
export const VERTICAL_EXAGGERATIONS=Object.freeze([1,2,3,5,10,20]);
let verticalExaggeration=1;
export function getVerticalExaggeration(){return verticalExaggeration}
export function setVerticalExaggeration(value){
 const factor=Number(value);if(!VERTICAL_EXAGGERATIONS.includes(factor))throw new Error('表示倍率は1・2・3・5・10・20倍から選択してください。');
 verticalExaggeration=factor;return factor;
}
export function projectDisplayPoint(x,y,height=0){return {x:500+(x-y)*.95,y:340+(x+y)*.43-height*.75*verticalExaggeration}}
export function unprojectDisplayPoint(point,height=0){const difference=(point.x-500)/.95,sum=(point.y-340+height*.75*verticalExaggeration)/.43;return {x:(sum+difference)/2,y:(sum-difference)/2}}
