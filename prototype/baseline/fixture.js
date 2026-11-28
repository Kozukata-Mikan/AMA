import {
  createDemoTerrain,
  resizeTerrain,
} from "../../tactical-map/terrain-data.js";
import { ship, source } from "../../tests/fixtures.mjs";
export function fleetFixture() {
  const scene = source();
  scene.name = "AMA · 200-unit persistence baseline";
  scene.instances = Array.from({ length: 200 }, (_, i) => {
    const u = ship(
      "baseline-" + i,
      i < 100 ? "ally" : "enemy",
      (i < 100 ? -200 : 100) + (i % 10) * 7,
    );
    u.y = Math.floor((i % 100) / 10) * 8 - 40;
    return u;
  });
  return scene;
}

export function movingFleet() {
  const scene = source(),
    base = createDemoTerrain();
  scene.terrain = resizeTerrain(base, {
    width: 14401,
    height: 14401,
    cols: 14402,
    rows: 14402,
    contourInterval: 6,
  });
  scene.name = "Moving fleet on 14401-cell map";
  scene.groups = [
    { id: "fleet", name: "Test fleet", kind: "formation", parentId: null },
  ];
  scene.instances = Array.from({ length: 200 }, (_, i) => {
    const u = ship("moving-" + i, "ally", 6000 + (i % 15) - 7);
    u.y = 6000 + Math.floor(i / 15) - 6;
    if (i === 0) {
      u.x = 6000;
      u.y = 6000;
      u.isFormationFlagship = true;
    }
    if (i === 97) {
      u.x = 5993;
      u.y = 5994;
    }
    u.groupId = "fleet";
    u.snapshot.naval.endurance = 100000;
    return u;
  });
  return scene;
}
