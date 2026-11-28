import test from "node:test";
import assert from "node:assert/strict";
import { createDemoTerrain } from "../../tactical-map/terrain-data.js";
import { createSurfaceLayer } from "./surface.js";

test("circular editing, persistent layers, coastline and undo", () => {
  const t = createDemoTerrain();
  t.heights.fill(1);
  const layer = createSurfaceLayer(t);
  layer.apply(0, 0, 4, "desert");
  assert.equal(layer.sample(0, 0).surface, "desert");
  assert.equal(layer.sample(4, 4).surface, "beach");
  layer.apply(0, 0, 0, "lower");
  assert.equal(layer.sample(0, 0).surface, "sea");
  const copy = createSurfaceLayer(
    t,
    JSON.parse(JSON.stringify(layer.serialize())),
  );
  assert.deepEqual(copy.sample(0, 0), layer.sample(0, 0));
  assert.equal(copy.canUndo, false);
  layer.undo();
  assert.equal(layer.sample(0, 0).surface, "desert");
  layer.undo();
  assert.deepEqual(layer.serialize().cells, []);
  assert.equal(
    t.heights.every((h) => h === 1),
    true,
  );
});

test("boundary coordinate and invalid import", () => {
  const t = createDemoTerrain();
  t.heights.fill(2);
  const layer = createSurfaceLayer(t);
  layer.apply(t.width / 2, t.height / 2, 0, "snow");
  assert.equal(layer.sample(t.width / 2, t.height / 2).surface, "snow");
  assert.equal(layer.serialize().cells.length, 1);
  assert.throws(() =>
    createSurfaceLayer(t, {
      version: 1,
      cells: [[t.width * t.height, 0, "grass"]],
    }),
  );
});

import { createLargeWorld, readWorld, worldSize } from "./world.js";
test("14401-square world addresses four corners separately and reloads sparse edits", () => {
  const world = createLargeWorld(),
    initial = JSON.stringify(world);
  const layer = createSurfaceLayer(world);
  const edge = (worldSize - 1) / 2;
  const points = [
    [-edge, -edge],
    [-edge, edge],
    [edge, -edge],
    [edge, edge],
  ];
  for (const [x, y] of points) layer.apply(x, y, 0, "raise");
  const saved = layer.serialize();
  assert.deepEqual(
    saved.cells.map((c) => c[0]),
    [0, worldSize * (worldSize - 1), worldSize - 1, worldSize ** 2 - 1],
  );
  const restored = createSurfaceLayer(
    readWorld(JSON.parse(initial)),
    JSON.parse(JSON.stringify(saved)),
  );
  for (const [x, y] of points)
    assert.deepEqual(restored.sample(x, y), layer.sample(x, y));
  assert.equal(restored.sample(edge + 1, edge).inside, false);
  assert.equal(restored.sample(-edge - 1, edge).inside, false);
  assert.equal(saved.cells.length, 4);
  assert.equal(JSON.stringify(world), initial);
  assert.equal(
    layer.sample(0, 0).height,
    createSurfaceLayer(world).sample(0, 0).height,
  );
});
