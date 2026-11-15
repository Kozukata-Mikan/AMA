import {generateDescribedTerrain,generateGeographicTerrain,normalizeGenerationOptions} from './terrain-generator.js';
import {loadCoastline,loadElevationSampler} from './terrain-geography.js';
export async function generateTerrainTask(payload){
 const o=normalizeGenerationOptions(payload.options);
 if(o.mode==='description')return generateDescribedTerrain(o);
 const coast=await loadCoastline();
 const sampler=o.elevation==='dem'?await loadElevationSampler(o):null;
 return generateGeographicTerrain(o,coast,sampler);
}
