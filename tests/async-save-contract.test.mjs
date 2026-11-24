import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {parse} from 'acorn';
function walk(n,visit,parent=null){if(!n?.type)return;visit(n,parent);for(const value of Object.values(n)){if(Array.isArray(value)){for(const c of value)if(c?.type)walk(c,visit,n)}else if(value?.type)walk(value,visit,n)}}
const mutators=new Set(['addAction','addCluster','addGroup','addUnit','beginMovement','cancelAttackCommands','cancelMovement','cancelRescuePlan','clear','createCluster','createGroup','dissolveGroup','endSimulation','finishSpecialPhase','finishTurn','importScene','newScene','planEquipmentRepair','planMovement','planRescue','removeAction','removeGroup','removeUnit','renameGroup','renameScene','resolveMovement','saveAttackCommands','saveDraft','setCampaignIntro','setEnemyAutonomy','setManualPas','setEnvironment','setObservationSide','setTerrain','settleAttackPhase','updateGroup','updateHp','updateUnit','updateUnits','updateView']);
test('UI calls await asynchronous store writes and constructors',async()=>{
 const failures=[];
 const files=(await readdir(new URL('../tactical-map/',import.meta.url))).filter(f=>/\.js$/.test(f)&&/(main|editor|deployment|library|ui|workbench)\.js$/.test(f));
 for(const file of files){
  const text=await readFile(new URL('../tactical-map/'+file,import.meta.url),'utf8');const ast=parse(text,{ecmaVersion:'latest',sourceType:'module',locations:true});const parents=new Map();walk(ast,(n,p)=>parents.set(n,p));
  walk(ast,(n,p)=>{
   if(n.type!=='CallExpression')return;
   const c=n.callee;
   const constructor=c.type==='Identifier'&&['createBattleStore','createSimulation','openSimulation'].includes(c.name);
   const write=c.type==='MemberExpression'&&!c.computed&&['store','battleStore','api'].includes(c.object.name)&&mutators.has(c.property.name);
   const callback=c.type==='Identifier'&&c.name==='commitUnit';
   if(!constructor&&!write&&!callback)return;
   if(p?.type==='ChainExpression')p=parents.get(p);
   if(!['AwaitExpression','ReturnStatement'].includes(p?.type))failures.push(file+':'+n.loc.start.line);
  });
 }
 assert.deepEqual(failures,[],'write UI must wait before displaying success');
});
test('simulation calculation callback stays synchronous inside the async persistence transaction',async()=>{
 const source=await readFile(new URL('../tactical-map/simulation-store.js?v=day-catalog-pas-1',import.meta.url),'utf8');
 assert(source.includes('const result = change(candidate);'));
 assert(!source.includes('const result = await change(candidate);'));
 assert(source.includes('savedRaw = await writeSaved(candidate, expectedRaw);'));
});
