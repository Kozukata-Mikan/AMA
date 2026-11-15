import {createDemoTerrain} from '../tactical-map/terrain-data.js';
export function flatTerrain(){const t=createDemoTerrain();t.heights.fill(-20);return t}
export function ship(id, side='ally', x=0){return {
 instanceId:id,unitId:id,name:id,branch:'navy',side,faction:'none',sizeLevel:1,
 x,y:0,heading:0,groupId:null,underwater:false,depth:0,currentHp:10,
 snapshot:{id,name:id,branch:'navy',maxHp:10,trainingTraits:[],naval:{type:'DD',strength:0,detection:'F',seaRecon:'F',airRecon:'F',armor:'F',speedKnots:10,endurance:100},mounts:[],equipmentSnapshots:[]}
}}
export function source(){return {version:2,name:'Performance regression',terrain:flatTerrain(),environment:{time:'12:00',weather:'clear'},instances:[ship('a'),ship('b','enemy',250)],groups:[],actions:[],view:{x:0,y:0,scale:1}}}

