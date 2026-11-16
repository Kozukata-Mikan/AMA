// node tests/compare-simulation-optimization.mjs BASELINE SCENE_JSON CATALOG_JSON
import {spawn} from 'node:child_process';import fs from 'node:fs/promises';import {resolve} from 'node:path';import {tmpdir} from 'node:os';import assert from 'node:assert/strict';
const [baseline,scene,catalog]=process.argv.slice(2);if(!catalog)throw Error('Pass baseline checkout, scene JSON and catalog JSON.');
const directory=await fs.mkdtemp(resolve(tmpdir(),'ama-semantic-')),probe=new URL('./simulation-optimization-probe.mjs',import.meta.url);
function run(root,out,scenario){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[probe.pathname,root,scene,catalog,out,scenario],{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('Probe failed: '+code)))})}
function firstDifference(a,b,path=''){if(Object.is(a,b))return null;if(!a||!b||typeof a!=='object'||typeof b!=='object')return {path,a,b};const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();if(JSON.stringify(ak)!==JSON.stringify(bk))return {path,keysA:ak,keysB:bk};for(const key of ak){const result=firstDifference(a[key],b[key],path+'/'+key);if(result)return result}return null}
let total=0;for(const scenario of ['campaign','contact','squadron']){
 const a=resolve(directory,scenario+'-before.json'),b=resolve(directory,scenario+'-after.json');await run(resolve(baseline),a,scenario);await run(process.cwd(),b,scenario);
 const old=JSON.parse(await fs.readFile(a,'utf8')),next=JSON.parse(await fs.readFile(b,'utf8'));const difference=firstDifference(old,next);assert.equal(difference,null,JSON.stringify(difference));total+=old.length;console.log(`Full state, observation whitelist, RNG outcomes and errors match: ${scenario}, ${old.length} stages.`)
}console.log(`Semantic comparison passed: ${total} stages. Private temporary traces: ${directory}`);
