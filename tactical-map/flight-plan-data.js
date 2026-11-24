export function validateFlightPlan(p){
 if(p==null)return;
 if(p.version!==1||!['CAR','CAS','CAP'].includes(p.kind)||!['outbound','attack','returning','complete'].includes(p.stage)||!['avoid','priority','adjust','escort','engage','conservative'].includes(p.behavior)||typeof p.homeId!=='string'||!p.homeId||!Number.isFinite(p.origin?.x)||!Number.isFinite(p.origin?.y)||!Number.isFinite(p.altitude)||p.altitude<1||!Number.isFinite(p.radius)||p.radius<=0||!Array.isArray(p.waypoints)||p.waypoints.length>100||p.waypoints.some(w=>!Number.isFinite(w.x)||!Number.isFinite(w.y))||!Number.isSafeInteger(p.cursor)||p.cursor<0||p.cursor>p.waypoints.length)throw Error('航空航路の保存状態が不正です。');
 if(!({CAR:['avoid','priority'],CAS:['adjust','escort'],CAP:['engage','conservative']})[p.kind].includes(p.behavior)||p.targetPoint&&(!Number.isFinite(p.targetPoint.x)||!Number.isFinite(p.targetPoint.y)))throw Error('航空任務の行動方針・目標位置が不正です。');
 if(p.kind==='CAS'&&p.behavior==='escort'&&typeof p.escortId!=='string'||p.kind==='CAS'&&p.behavior!=='escort'&&typeof p.targetId!=='string')throw Error('航空任務の目標参照が不正です。');
}
