import {source,ship} from '../fixtures.mjs';
import {normalizeAircraft} from '../../js/aircraft-template.js';
import {supportEquipmentSeed} from '../../tactical-map/support-equipment.js?v=settlement-audit-1';

export const TEST_SEED = 20261125;
export function weapon(id,projection,power,order,{guidance='平射',range=200,scope='単体',penetration='A'}={}) {
  return {id,name:id,kind:'weapon',barrelCount:1,projectionCoefficient:projection,projectionSuffix:'R',ammo:600,
    powerRule:String(power),penetration,guidance,range,ceilingU:100,maxOrder:String(order),targetScope:scope};
}
export function aircraft(id,{engines=2,maneuverability='3R',training='regular',activeOrder=5,bombOrder=3,bombPower=2}={}) {
  const unit=ship(id).snapshot;
  Object.assign(unit,{id,name:id,branch:'air',sizeLevel:1,maxHp:engines});
  unit.aircraft=normalizeAircraft({type:'carrier',engines,crew:1,training,maneuverability,ceiling:100,attackModes:['dive','torpedo','level'],loadouts:[{id:'strike',name:'攻撃装備',mounts:[{equipmentId:id+'・爆弾',count:1}]}]});
  unit.naval={...unit.naval,armor:'F',speedKnots:20,endurance:'200',detection:'F',seaRecon:'A',airRecon:'A'};
  unit.mounts=[{position:'主動武器',equipmentId:id+'・機銃',count:1},{position:'自衛武器',equipmentId:id+'・自衛銃',count:1}];
  unit.equipmentSnapshots=[weapon(id+'・機銃',1,1,activeOrder),weapon(id+'・自衛銃',1,1,5),weapon(id+'・爆弾',2,bombPower,bombOrder)];
  return unit;
}
export function host(id,side,x,{building=false,templates=[],counts=[],runways=3,aa=[]}={}) {
  const u=ship(id,side,x);u.name=id;
  u.currentHp=u.snapshot.maxHp=building?60:80;
  u.snapshot.naval={...u.snapshot.naval,type:building?'':'CV',armor:'C',speedKnots:0,endurance:'1k',airRecon:'A',seaRecon:'A'};
  if(building){u.branch=u.snapshot.branch='building';u.snapshot.building={kind:'airport',airportType:'runway',permanence:'permanent',runways:3};}
  u.snapshot.aircraftSnapshots=templates;
  u.snapshot.aviationComplement=templates.map((t,i)=>({unitId:t.id,count:counts[i],groupId:null}));
  u.snapshot.equipmentSnapshots=[];u.snapshot.mounts=[];
  for(const [role,count]of [['parking-stand',100],['preparation-area',4],['runway',runways]]) {
    const e=supportEquipmentSeed().find(e=>e.supportEffect===role);
    u.snapshot.equipmentSnapshots.push(e);u.snapshot.mounts.push({position:building?'露天':'後部',equipmentId:e.id,count});
  }
  for(const e of aa){u.snapshot.equipmentSnapshots.push(e);u.snapshot.mounts.push({position:building?'露天':'中部①',equipmentId:e.id,count:1});}
  return u;
}
export function carrierAirStrikeScene() {
  const s=source();s.name='航空連携検証・飛行場対空母小艦隊';s.environment={time:'12:00',weather:'clear'};
  const A=aircraft('A隊',{training:'elite',activeOrder:5,bombOrder:5,bombPower:1});
  const B=aircraft('B隊',{activeOrder:3,bombOrder:3,bombPower:2});
  const C=aircraft('C隊',{activeOrder:2,bombOrder:2,bombPower:3});
  const D=aircraft('D隊',{training:'elite',engines:2,maneuverability:'4R'});
  const airport=host('味方飛行場','ally',-50,{building:true,templates:[A,B,C],counts:[6,12,6]});
  const carrier=host('敵空母','enemy',40,{templates:[D],counts:[9],runways:1,aa:[weapon('空母対空砲・次序3',60,1,3),weapon('空母PAS',6,1,'PAS',{range:120})]});
  carrier.groupId='enemy-fleet';carrier.isFormationFlagship=true;
  const escorts=['護衛艦1','護衛艦2'].map((id,i)=>{
    const u=ship(id,'enemy',40);u.y=i?25:-25;u.groupId='enemy-fleet';u.currentHp=u.snapshot.maxHp=30;
    u.snapshot.naval={...u.snapshot.naval,speedKnots:0,armor:'C',airRecon:'A',seaRecon:'A',endurance:'1k'};
    u.snapshot.equipmentSnapshots=[weapon(id+'・対空砲B',60,1,4),weapon(id+'・対空砲C',30,1,4)];
    u.snapshot.mounts=u.snapshot.equipmentSnapshots.map(e=>({position:'中部①',equipmentId:e.id,count:1}));return u;
  });
  s.instances=[airport,carrier,...escorts];s.groups=[{id:'enemy-fleet',name:'敵空母小艦隊',kind:'fleet',parentId:null,flagshipId:'敵空母'}];
  return s;
}
