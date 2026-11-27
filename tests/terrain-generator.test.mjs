import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {parseTerrainDescription,normalizeGenerationOptions,generateDescribedTerrain,generateGeographicTerrain,geographicBounds,geographicPoint,makeGenerationGrid,rasterizeCoastline} from '../tactical-map/terrain-generator.js';
import {decodeCoastline,elevationTilePlan,terrariumMeters,searchGeographicPlaces} from '../tactical-map/terrain-geography.js';
import {sampleTerrain,readTerrainVertex,freezeTerrainSnapshot,validateTerrain,applyBrush} from '../tactical-map/terrain-data.js';
import {beginTerrainEdit,applyTerrainFrame} from '../tactical-map/terrain-edit-history.js';
import {generationPreviewImage} from '../tactical-map/terrain-generator-panel.js?v=aviation-deck-1';
for(const [description,kind,length]of [['我想要生成一片连绵10km左右的山脉','mountains',10],['20kmの群島','archipelago',20],['a 10km mountain range','mountains',10],['南北延伸30公里的丘陵','hills',30],['长10km的山谷','valley',10]])test(`description parsing: ${description}`,()=>{const p=parseTerrainDescription(description);assert.equal(p.kind,kind);assert.equal(p.lengthKm,length)});
test('description parameters and invalid input are explicit',()=>{
 assert.equal(parseTerrainDescription('东西10km山脉，高度1500m').heightMeters,1500);assert.equal(parseTerrainDescription('南北10km山脉').angle,90);
 for(const s of ['', '随便来一点', 'x'.repeat(501)])assert.throws(()=>parseTerrainDescription(s));
 for(const options of [{widthKm:1441},{heightKm:0},{detail:1025},{seed:-1},{seed:1.5},{kind:'port'},{mode:'unknown'},{heightMeters:60001},{seaDepthMeters:20001},{mode:'geographic',latitude:'',longitude:123}])assert.throws(()=>normalizeGenerationOptions(options));
});
for(const kind of ['mountains','hills','island','archipelago','plain','ocean','coast','river','valley'])test(`generation is deterministic and editable: ${kind}`,()=>{
 const options={kind,widthKm:24,heightKm:24,lengthKm:10,seed:938};const a=generateDescribedTerrain(options),b=generateDescribedTerrain(options);assert.deepEqual(a,b);assert.equal(a.terrain.cols,121);assert.equal(a.terrain.width/5,24);
 const frozen=freezeTerrainSnapshot(a.terrain),edit=beginTerrainEdit(frozen);applyBrush(edit.working,{x:0,y:0},{mode:'raise',radius:20,strength:10,target:0});const next=freezeTerrainSnapshot(edit.working);assert.equal(next.generation.label,kind);assert.deepEqual(validateTerrain(applyTerrainFrame(next,edit.frame(),false)),validateTerrain(frozen));
 assert(generationPreviewImage(frozen).startsWith('data:image/svg+xml'));
});
test('7200-cell maximum remains sparse and generated interval is disclosed',()=>{
 const r=generateDescribedTerrain({widthKm:1440,heightKm:1440,lengthKm:1000,detail:257});assert.equal(r.terrain.cols,7201);assert.equal(r.terrain.rows,7201);assert.equal(r.terrain.width,7200);assert(r.summary.spacingMeters>200);assert.equal(r.terrain.base.cols,257);assert.equal(Object.keys(r.terrain.chunks).length,0);
});
const ring=(a,b,c,d)=>[a,b,c,b,c,d,a,d,a,b].map(x=>x*10000);
const coast={version:1,scale:10000,polygons:[{b:[-2,-2,2,2].map(x=>x*10000),r:[ring(-2,-2,2,2),ring(-.2,-.2,.2,.2)]}]};
test('real geographic masks honor holes, north and east and physical distance',()=>{
 const o=normalizeGenerationOptions({mode:'geographic',latitude:0,longitude:0,widthKm:100,heightKm:100,elevation:'flat'}),grid=makeGenerationGrid(o),mask=rasterizeCoastline(coast,o,grid);
 assert.equal(mask[0],1);assert.equal(mask[Math.floor(grid.rows/2)*grid.cols+Math.floor(grid.cols/2)],0);
 const nw=geographicPoint(o,0,0,grid),se=geographicPoint(o,grid.cols-1,grid.rows-1,grid);assert(nw.latitude>se.latitude);assert(nw.longitude<se.longitude);assert(Math.abs((se.longitude-nw.longitude)*111.195-100)<.001);
 const t=generateGeographicTerrain(o,coast);assert.equal(sampleTerrain(t.terrain,0,0).kind,'sea');assert.equal(sampleTerrain(t.terrain,200,200).kind,'land');assert.equal(t.terrain.generation.elevation,'flat');
 assert.throws(()=>generateGeographicTerrain({...o,elevation:'dem'},coast));assert.throws(()=>generateGeographicTerrain({...o,elevation:'dem'},coast,()=>NaN));
 const dem=generateGeographicTerrain({...o,elevation:'dem'},coast,()=>1000);assert.equal(readTerrainVertex(dem.terrain,0,0)[0],10);
});
test('antimeridian geography keeps polygons on both sides',()=>{
 const o=normalizeGenerationOptions({mode:'geographic',latitude:0,longitude:180,widthKm:400,heightKm:400,elevation:'flat'});
 const data={version:1,scale:10000,polygons:[{b:[179,-2,180,2].map(x=>x*10000),r:[ring(179,-2,180,2)]},{b:[-180,-2,-179,2].map(x=>x*10000),r:[ring(-180,-2,-179,2)]}]};
 const t=generateGeographicTerrain(o,data).terrain;assert.equal(sampleTerrain(t,-100,0).kind,'land');assert.equal(sampleTerrain(t,100,0).kind,'land');
});
test('bundled coastline produces Cebu and neighboring islands, not a random outline',async()=>{
 const data=await decodeCoastline(await fs.readFile(new URL('../data/terrain-land.b64',import.meta.url),'utf8'));
 const o=normalizeGenerationOptions({mode:'geographic',latitude:10.3,longitude:123.8,widthKm:220,heightKm:280,elevation:'flat'}),r=generateGeographicTerrain(o,data);
 assert(r.summary.landFraction>.25&&r.summary.landFraction<.6);assert.equal(sampleTerrain(r.terrain,0,0).kind,'land');assert.equal(sampleTerrain(r.terrain,0,-600).kind,'sea');
 assert.equal(r.terrain.width,1100);assert.equal(r.terrain.height,1400);assert.equal(validateTerrain(r.terrain).generation.latitude,10.3);
});
test('DEM decoding, tile bounds and offline place presets',async()=>{
 assert.equal(terrariumMeters(128,0,0),0);assert.equal(terrariumMeters(128,3,128),3.5);
 for(const longitude of [-180,0,123.8,180])for(const latitude of [-70,0,70]){const o=normalizeGenerationOptions({mode:'geographic',latitude,longitude,widthKm:1440,heightKm:1440});const p=elevationTilePlan(o);assert((p.x1-p.x0+1)*(p.y1-p.y0+1)<=16);assert(p.z>=0)}
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('offline')};try{const places=await searchGeographicPlaces('我想要生成菲律宾的宿务群岛');assert.equal(places[0].latitude,10.3)}finally{globalThis.fetch=original}
});
