import {
  freezeTerrainSnapshot,
  forkTerrainForEditing,
  readTerrainVertex,
  writeTerrainOverride,
  sampleTerrain,
} from "./terrain-data.js";

// Terrain changes use the game's one-level voxel step. Preserve the deployment grid as the base.
export function settleTerrainEvents(terrain, selections) {
  let edited;
  for (const { blast } of selections ?? []) {
    if (!blast || !(blast.radius > 0)) continue;
    const { center, radius } = blast;
    if (!sampleTerrain(terrain, center.x, center.y).inside) continue;
    const cols = Math.ceil(terrain.width) + 1,
      rows = Math.ceil(terrain.height) + 1;
    const dx = terrain.width / (cols - 1),
      dy = terrain.height / (rows - 1);
    const gx = (center.x + terrain.width / 2) / dx,
      gy = (center.y + terrain.height / 2) / dy;
    for (
      let j = Math.max(0, Math.ceil(gy - radius / dy));
      j <= Math.min(rows - 1, Math.floor(gy + radius / dy));
      j++
    ) {
      for (
        let i = Math.max(0, Math.ceil(gx - radius / dx));
        i <= Math.min(cols - 1, Math.floor(gx + radius / dx));
        i++
      ) {
        const x = i * dx - terrain.width / 2,
          y = j * dy - terrain.height / 2;
        const s = sampleTerrain(edited ?? terrain, x, y);
        if (
          s.height <= 0 ||
          Math.hypot(x - center.x, y - center.y, s.height - center.z) > radius
        )
          continue;
        if (!edited) {
          const same = terrain.cols === cols && terrain.rows === rows;
          edited = same
            ? forkTerrainForEditing(terrain)
            : {
                version: 3,
                width: terrain.width,
                height: terrain.height,
                cols,
                rows,
                contourInterval: terrain.contourInterval,
                base: terrain,
                chunks: {},
                chunkSize: 32,
                ...(terrain.generation
                  ? { generation: terrain.generation }
                  : {}),
              };
        }
        const [h, river, shallow] = readTerrainVertex(edited, i, j);
        writeTerrainOverride(edited, j * cols + i, [
          Math.max(0, h - 1),
          river,
          shallow,
        ]);
      }
    }
  }
  return edited ? freezeTerrainSnapshot(edited) : terrain;
}
