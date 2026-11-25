import {source,ship} from '../fixtures.mjs';
import {aircraft,host,weapon} from './carrier-air-strike.mjs';
import {supportEquipmentSeed} from '../../tactical-map/support-equipment.js?v=field-support-1';
const support=(u,role)=>{const e=supportEquipmentSeed().find(e=>e.supportEffect===role);u.equipmentSnapshots.push(e);u.mounts.push({position:u.branch==='air'?'ポッド':'露天',equipmentId:e.id,count:1});};
function plane(id,traits=[],{training='elite',night=false,asw=false,engines=2}={}){
 const p=aircraft(id,{training,engines,bombOrder:3,bombPower:2});p.aircraft.traits=traits;p.aircraft.acePilotName=id+'・エース';
 p.aircraft.attackModes.push('bvr');p.naval.aswRecon='A';p.naval.endurance='400';
 if(asw){const bomb=p.equipmentSnapshots.at(-1);bomb.guidance='数控（水下）';bomb.powerRule='艦砲規則';}
 if(night)support(p,'night-observation');
 return p;
}
const addNight=h=>support(h.snapshot,'night-observation');
function fleet(s,side,carrier,number){const id=side+'-fleet';carrier.groupId=id;carrier.isFormationFlagship=true;s.groups.push({id,name:side==='ally'?'味方空母艦隊':'敵艦隊',kind:'fleet',parentId:null,flagshipId:carrier.instanceId});for(let i=1;i<number;i++){const u=ship((side==='ally'?'味方':'敵')+'護衛'+i,side,carrier.x+(i%3)*3);u.y=Math.floor(i/3)*4+4;u.groupId=id;u.currentHp=u.snapshot.maxHp=80;u.snapshot.naval={...u.snapshot.naval,speedKnots:0,armor:'C',seaRecon:'A',airRecon:'A',endurance:'1k'};s.instances.push(u);}return id;}
export function fourAirScene(n){
 const s=source();s.instances=[];s.groups=[];s.environment={day:1,time:n===3?'23:00':'12:00',weather:'clear'};
 const spec={number:n,scene:s,sorties:[],rounds:n===3?7:6};
 function base(id,side,x,templates,counts,{building=true,aa=[]}={}){const u=host(id,side,x,{building,templates,counts,runways:Math.max(1,templates.length),aa});u.currentHp=u.snapshot.maxHp=building?240:120;u.snapshot.naval.aswRecon='A';s.instances.push(u);return u;}
 function sortie(home,templates,{cap=false,targetId,altitude=20,behavior='adjust',radius=80}={}){for(const p of templates)spec.sorties.push({hostId:home.instanceId,side:home.side,name:p.id,plan:cap?{kind:'CAP',behavior:'engage',radius,altitude}:{kind:'CAS',behavior,targetId,attackMethod:'bvr',altitude},loadoutId:cap?null:'strike'});}
 if(n===1){
  s.name='試験1・空母三隊対飛行場と殉道';const ps=[plane('A殉道隊',['martyr']),plane('B攻撃隊',['fearless']),plane('C攻撃隊',['fearless'])],d=plane('D防衛隊',['fearless']);for(const e of d.equipmentSnapshots)e.ammo=1;
  const cv=base('味方空母','ally',-40,ps,[9,6,6],{building:false});fleet(s,'ally',cv,3);
  const ap=base('敵飛行場','enemy',40,[d],[9],{aa:[weapon('飛行場対空砲',1,2,4,{guidance:'数控',range:250})]});
  sortie(cv,ps,{targetId:ap.instanceId});sortie(ap,[d],{cap:true,radius:30});
 }else if(n===2){
  s.name='試験2・対潜航空攻撃と遊雲・弁舌';const ps=[plane('A遊雲隊',['low-cloud'],{asw:true}),plane('B弁舌隊',['eloquence'],{asw:true})];
  const ap=base('味方飛行場','ally',-40,ps,[6,6]);const sub=ship('敵潜水艦','enemy',40);sub.underwater=true;sub.depth=2;sub.currentHp=sub.snapshot.maxHp=120;sub.snapshot.naval={...sub.snapshot.naval,kind:'submarine',underwaterSpeedKnots:0,speedKnots:0,armor:'C',detection:'F',endurance:'1k'};s.instances.push(sub);sortie(ap,ps,{targetId:sub.instanceId,altitude:20});
 }else if(n===3){
  s.name='試験3・夜間八隊と無畏・伏撃・希孚';
  const ally=[plane('A無畏隊',['fearless'],{night:true}),plane('B伏撃隊',['ambush'],{night:true}),plane('C希孚隊',['sifu'],{night:true,training:'ace'}),plane('D通常隊',[],{night:true,training:'regular'})];
  const enemy=[plane('E無畏隊',['fearless'],{night:true}),plane('F伏撃隊',['ambush'],{night:true}),plane('G希孚隊',['sifu'],{night:true,training:'ace'}),plane('H通常隊',[],{night:true,training:'regular'})];
  const a=base('味方夜間飛行場','ally',-75,ally,[6,6,6,6]),b=base('敵夜間飛行場','enemy',75,enemy,[6,6,6,6]);addNight(a);addNight(b);b.snapshot.naval.airRecon='F';
  // One forward observer supplies identification for the allied ambush while
  // enemy low-grade airborne reconnaissance cannot detect its approach.
  for(const [side,x]of [['ally',70]]){const u=ship(side+'前進観測所',side,x);u.y=60;u.snapshot.naval.speedKnots=0;u.snapshot.naval.airRecon='A';s.instances.push(u);}
  for(const p of [...ally,...enemy]){p.naval.airRecon='F';p.naval.detection='A';p.aircraft.maneuverability=p.aircraft.traits.includes('fearless')?'1R':'3R';p.equipmentSnapshots.forEach(e=>{e.guidance='数控';});}
  // Stand-off CAR legs retain 150-grid separation for hidden ambush checks.
  for(const [h,ps]of [[a,ally],[b,enemy]])for(const p of ps)spec.sorties.push({hostId:h.instanceId,side:h.side,name:p.id,loadoutId:null,plan:{kind:'CAR',behavior:'priority',altitude:20,waypoints:[{x:h.x,y:120}]}});
 }else{
  s.name='試験4・三隊対八隻編隊と節約';const ps=[plane('A節約隊',['economy','fearless']),plane('B節約隊',['economy','fearless']),plane('C節約隊',['economy','fearless'])];const ap=base('味方飛行場','ally',-40,ps,[9,9,9]);
  const flagship=base('敵旗艦','enemy',40,[],[],{building:false});fleet(s,'enemy',flagship,8);for(const u of s.instances.filter(u=>u.side==='enemy'))u.currentHp=u.snapshot.maxHp=12;
  sortie(ap,ps,{targetId:'group:enemy-fleet'});
 }
 return spec;
}
