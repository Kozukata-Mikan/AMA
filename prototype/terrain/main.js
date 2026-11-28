import { createLargeWorld, readWorld, sampleWorld } from "./world.js";
import { createSurfaceLayer, surfaces, paintable } from "./surface.js";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createDemoTerrain } from "../../tactical-map/terrain-data.js";

const el = (id) => document.getElementById(id);
const view = el("view"),
  map = el("map"),
  ctx = map.getContext("2d");
const scene = new T.Scene(),
  camera = new T.PerspectiveCamera(42, 1, 0.1, 100000);
const ground = new T.Group(),
  marker = new T.Group();
const harbor = new T.Group();
const dockMaterial = new T.MeshBasicMaterial({ color: 0xf6cd85 });
for (const [x, z, w, d] of [
  [0, 0, 2, 8],
  [2, 3, 6, 2],
  [2, -2, 6, 2],
]) {
  const dock = new T.Mesh(new T.BoxGeometry(w, 1.5, d), dockMaterial);
  dock.position.set(x, 0.75, z);
  harbor.add(dock);
}
scene.add(ground, marker, harbor);
scene.background = new T.Color(0x1b303c);
const material = new T.MeshBasicMaterial({
  vertexColors: true,
  side: T.DoubleSide,
});
const pin = new T.Mesh(
  new T.OctahedronGeometry(1),
  new T.MeshBasicMaterial({ color: 0xffce67 }),
);
marker.add(pin);
marker.visible = false;
let terrain,
  selection,
  port,
  renderer,
  controls,
  frame = 0,
  rebuild = true,
  reference;
let layer;
const palette = Object.fromEntries(
  Object.entries(surfaces).map(([id, [, color]]) => [id, color]),
);
const colors = Object.fromEntries(
  Object.entries(palette).map(([id, color]) => [id, new T.Color(color)]),
);
const height = (s) => Math.max(0, Math.round(s.height)) * 0.5;
function drawReference() {
  ctx.putImageData(reference, 0, 0);
  for (const [pos, color] of [
    [port, "#fff0a3"],
    [selection, "#ff855f"],
  ]) {
    if (!pos) continue;
    ctx.beginPath();
    ctx.arc(
      (pos.x / terrain.width + 0.5) * map.width,
      (pos.y / terrain.height + 0.5) * map.height,
      3,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = color;
    ctx.fill();
    ctx.stroke();
  }
}
function select(x, y, focus = false) {
  const s = layer.sample(x, y);
  if (!s.inside) return;
  selection = { x, y };
  el("apply").disabled = false;
  el("point").textContent =
    "X " +
    x.toFixed(2) +
    "　Y " +
    y.toFixed(2) +
    " ｜ " +
    surfaces[s.surface][0] +
    " ｜ 高程 " +
    (s.height * 100).toFixed(0) +
    " m";
  if (focus && controls) {
    controls.target.set(x, height(s) * ground.scale.y, y);
    const d = Math.min(
      100,
      Math.max(15, Math.max(terrain.width, terrain.height) / 7),
    );
    camera.position.copy(controls.target).add(new T.Vector3(d, d, d));
    controls.update();
  }
  marker.visible = true;
  marker.position.set(x, height(s) * ground.scale.y + 2, y);
  drawReference();
  schedule();
}
function overview() {
  if (!controls) return;
  const d = Math.max(terrain.width, terrain.height);
  controls.target.set(0, 0, 0);
  camera.position.set(d * 0.64, d * 0.97, d * 0.89);
  camera.far = d * 12 + 1000;
  camera.updateProjectionMatrix();
  controls.maxDistance = d * 4;
  controls.update();
  schedule();
}
function load(t, name, isDemo, scenePort = null, savedLayer) {
  layer = createSurfaceLayer(t, savedLayer);
  setNames([]);
  el("apply").disabled = true;
  el("undo").disabled = true;
  terrain = t;
  for (const [id, extent] of [
    ["coordX", t.width],
    ["coordY", t.height],
  ]) {
    const input = el(id);
    input.min = -extent / 2;
    input.max = extent / 2;
    input.value = 0;
  }
  selection = null;
  port = scenePort;
  marker.visible = false;
  el("point").textContent = "点击地图查看地格坐标与当前高程。";
  map.height = Math.max(
    1,
    Math.round((224 * t.height) / Math.max(t.width, t.height)),
  );
  map.width = Math.max(
    1,
    Math.round((224 * t.width) / Math.max(t.width, t.height)),
  );
  map.style.maxWidth = map.width + "px";
  updateReference(isDemo);
  harbor.visible = Boolean(port);
  if (port)
    harbor.position.set(
      port.x,
      height(layer.sample(port.x, port.y)) * ground.scale.y,
      port.y,
    );
  el("port").textContent = isDemo ? "示例港址" : "港口位置";
  el("port").hidden = !port;
  el("status").textContent =
    name +
    " · " +
    t.width +
    " × " +
    t.height +
    " 格" +
    (renderer ? "" : " · 当前仅二维显示");
  drawReference();
  clearTiles();
  overview();
  schedule();
}
function updateReference(isDemo = false) {
  const t = terrain;
  const w = map.width,
    h = map.height;
  reference = ctx.createImageData(w, h);
  let best = Infinity;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = ((i + 0.5) / w - 0.5) * t.width,
        y = ((j + 0.5) / h - 0.5) * t.height,
        s = layer.sample(x, y);
      const rgb = parseInt(palette[s.surface].slice(1), 16),
        k = (j * w + i) * 4;
      reference.data.set([rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255], k);
      if (isDemo && s.height <= 0) {
        const score =
          Math.abs(s.height) * 30 +
          Math.hypot(x - t.width * 0.15, y - t.height * 0.12) * 0.03;
        if (score < best) {
          best = score;
          port = { x, y };
        }
      }
    }
}
const tiles = new Map();
function clearTiles(bounds) {
  rebuild = true;
  for (const [key, m] of tiles) {
    if (bounds) {
      const [x, y, size] = key.split(",").map(Number);
      const margin = bounds.r + size / 16;
      if (
        x > bounds.x + margin ||
        x + size < bounds.x - margin ||
        y > bounds.y + margin ||
        y + size < bounds.y - margin
      )
        continue;
    }
    tiles.delete(key);
    ground.remove(m);
    m.geometry.dispose();
  }
}
function makeTile(left, top, span) {
  const step = span / 16,
    positions = [],
    shades = [],
    indices = [];
  function quad(a, b, c, d, color, shade) {
    const n = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++)
      shades.push(color.r * shade, color.g * shade, color.b * shade);
    indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  const xmax = terrain.width / 2,
    ymax = terrain.height / 2;
  for (let j = 0; j < 16; j++)
    for (let i = 0; i < 16; i++) {
      const x = left + i * step,
        z = top + j * step,
        x1 = Math.min(x + step, xmax),
        z1 = Math.min(z + step, ymax);
      if (x >= x1 || z >= z1) continue;
      const cx = (x + x1) / 2,
        cz = (z + z1) / 2,
        s = layer.sample(cx, cz),
        h = height(s),
        color = colors[s.surface];
      quad([x, h, z], [x1, h, z], [x1, h, z1], [x, h, z1], color, 1);
      if (h === 0) continue;
      // Vertical faces extend to the base, including across different LODs.
      for (const [ax, az, bx, bz, dx, dz, k] of [
        [x, z, x1, z, 0, -step, 0.72],
        [x1, z, x1, z1, step, 0, 0.8],
        [x1, z1, x, z1, 0, step, 0.76],
        [x, z1, x, z, -step, 0, 0.85],
      ]) {
        if (
          i === 0 ||
          i === 15 ||
          j === 0 ||
          j === 15 ||
          height(layer.sample(cx + dx, cz + dz)) < h
        )
          quad([ax, 0, az], [bx, 0, bz], [bx, h, bz], [ax, h, az], color, k);
      }
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new T.Float32BufferAttribute(shades, 3));
  g.setIndex(indices);
  return new T.Mesh(g, material);
}
function updateTiles() {
  const side =
      2 ** Math.ceil(Math.log2(Math.max(16, terrain.width, terrain.height))),
    wanted = new Set();
  const target = controls.target,
    dist = camera.position.distanceTo(target);
  function visit(x, z, s) {
    if (x >= terrain.width / 2 || z >= terrain.height / 2) return;
    const d = Math.hypot(
      Math.max(x - target.x, 0, target.x - x - s),
      Math.max(z - target.z, 0, target.z - z - s),
    );
    if (s > 16 && s > Math.max(dist * 0.22, d * 0.8)) {
      const half = s / 2;
      visit(x, z, half);
      visit(x + half, z, half);
      visit(x, z + half, half);
      visit(x + half, z + half, half);
      return;
    }
    const key = x + "," + z + "," + s;
    wanted.add(key);
    if (!tiles.has(key)) {
      const m = makeTile(x, z, s);
      tiles.set(key, m);
      ground.add(m);
    }
  }
  visit(-terrain.width / 2, -terrain.height / 2, side);
  for (const [key, m] of tiles)
    if (!wanted.has(key)) {
      ground.remove(m);
      m.geometry.dispose();
      tiles.delete(key);
    }
}
let drawNames=()=>{};
function schedule() {
  if (frame || !renderer || !terrain) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (rebuild) updateTiles();
    rebuild = false;
    renderer.render(scene, camera);
    drawNames();
  });
}
try {
  renderer = new T.WebGLRenderer({ antialias: true });
} catch {
  el("hint").textContent = "当前环境未启用 WebGL 2，可在二维参照图中查看地形。";
}
if (renderer) {
  view.prepend(renderer.domElement);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 4;
  controls.addEventListener("change", () => {
    rebuild = true;
    schedule();
  });
  new ResizeObserver(() => {
    renderer.setSize(view.clientWidth, view.clientHeight, false);
    camera.aspect = view.clientWidth / view.clientHeight;
    camera.updateProjectionMatrix();
    schedule();
  }).observe(view);
  let down;
  const ray = new T.Raycaster();
  renderer.domElement.addEventListener("pointerdown", (e) => {
    down = [e.clientX, e.clientY];
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (
      e.button !== 0 ||
      !down ||
      Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4
    )
      return;
    const r = view.getBoundingClientRect();
    ray.setFromCamera(
      new T.Vector2(
        (2 * (e.clientX - r.left)) / r.width - 1,
        1 - (2 * (e.clientY - r.top)) / r.height,
      ),
      camera,
    );
    const hit = ray.intersectObjects(ground.children, false)[0];
    if (hit) select(hit.point.x, hit.point.z);
  });
}
el("scale").oninput = (e) => {
  ground.scale.y = Number(e.target.value);
  el("factor").textContent = ground.scale.y + "×";
  if (port)
    harbor.position.y = height(layer.sample(port.x, port.y)) * ground.scale.y;
  if (selection) select(selection.x, selection.y);
  schedule();
};
ground.scale.y = 2;
map.onclick = (e) => {
  const r = map.getBoundingClientRect();
  select(
    ((e.clientX - r.left) / r.width - 0.5) * terrain.width,
    ((e.clientY - r.top) / r.height - 0.5) * terrain.height,
    true,
  );
};
el("locate").onsubmit = (e) => {
  e.preventDefault();
  select(el("coordX").valueAsNumber, el("coordY").valueAsNumber, true);
};
el("large").onclick = () => load(createLargeWorld(), "大地图样例", true);
el("home").onclick = overview;
el("port").onclick = () => select(port.x, port.y, true);
el("file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const src = data.terrain ? data : (data.scene ?? data.initialScene ?? data);
    const t = readWorld(src.terrain ?? src);
    const harborUnit =
      Array.isArray(src.instances) &&
      src.instances.find(
        (u) =>
          u?.snapshot?.building?.kind === "port" &&
          sampleWorld(t, u.x, u.y).inside,
      );
    load(
      t,
      file.name,
      false,
      harborUnit
        ? { x: harborUnit.x, y: harborUnit.y }
        : data.previewPort &&
            sampleWorld(t, data.previewPort.x, data.previewPort.y).inside
          ? data.previewPort
          : null,
      data.surfaceLayer,
    );
    if(Array.isArray(src.instances))setNames(src.instances.filter(u=>u?.branch==="navy"&&Number.isFinite(u.x)&&Number.isFinite(u.y)&&typeof u.name==="string"));
  } catch (err) {
    el("status").textContent = "导入失败 ｜ " + err.message;
  } finally {
    e.target.value = "";
  }
};
for (const id of paintable) el("brush").add(new Option(surfaces[id][0], id));
function refreshEdits(bounds) {
  if (!bounds) return;
  updateReference();
  clearTiles(bounds);
  select(selection.x, selection.y);
  if (port)
    harbor.position.y = height(layer.sample(port.x, port.y)) * ground.scale.y;
  el("undo").disabled = !layer.canUndo;
}
el("apply").onclick = () =>
  refreshEdits(
    layer.apply(
      selection.x,
      selection.y,
      Number(el("radius").value),
      el("brush").value,
    ),
  );
el("undo").onclick = () => refreshEdits(layer.undo());
el("export").onclick = () => {
  const blob = new Blob(
    [
      JSON.stringify({
        terrain,
        previewPort: port,
        surfaceLayer: layer.serialize(),
      }),
    ],
    { type: "application/json" },
  );
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "AMA-terrain-project.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
  const toggle=document.createElement("input");toggle.type="checkbox";
  const toggleLabel=document.createElement("label");toggleLabel.append(toggle," 显示舰名");el("liveUnits").after(toggleLabel);
  const names=document.createElement("div");names.style.cssText="position:absolute;inset:0;overflow:hidden;pointer-events:none";view.append(names);
  let labels=[];
  toggle.onchange=()=>{names.hidden=!toggle.checked;schedule();};
  drawNames=()=>{
    if(!toggle.checked)return;
    const occupied=[],w=view.clientWidth,h=view.clientHeight;
    for(const {unit,label} of labels){
      const pt=new T.Vector3(unit.x,2,unit.y).project(camera);
      const x=(pt.x+1)*w/2,y=(1-pt.y)*h/2-18;
      const right=x+Math.min(200,unit.name.length*14+10);
      const show=pt.z>=-1&&pt.z<=1&&x>=0&&x<w&&y>=0&&y<h&&!occupied.some(r=>r.x<right&&x<r.right&&Math.abs(y-r.y)<18);
      label.hidden=!show;
      if(show){occupied.push({x,right,y});label.style.transform="translate("+x+"px,"+y+"px)";}
    }
  };
function setNames(units){
    names.replaceChildren();names.hidden=!toggle.checked;
    labels=units.filter(u=>u.name).map(unit=>{
      const label=document.createElement("span");label.textContent=unit.name;
      label.style.cssText="position:absolute;top:0;left:0;background:#10202bdd;color:#fff;padding:0 4px;font-size:12px;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis";
      names.append(label);return {unit,label};
    });
toggleLabel.hidden=!labels.length;
 schedule();
}
el("demo").onclick = () => load(createDemoTerrain(), "AMA 示例岛屿", true);
el("demo").click();

// Live mode receives only the simulation's observed scene; editing remains in the standalone editor.
if (new URLSearchParams(location.search).has("live")) {
  for (const id of [
    "file",
    "demo",
    "large",
    "brush",
    "radius",
    "apply",
    "undo",
    "export",
  ]) {
    const e = el(id);
    (e.closest("label") ?? e).hidden = true;
  }
  for (const heading of document.querySelectorAll("aside h2"))
    if (heading.textContent === "地表编辑") {
      heading.hidden = true;
      const paragraph = el("apply").previousElementSibling;
      if (paragraph?.tagName === "P") paragraph.hidden = true;
    }
  let hulls,
    smoke,
    active = false;
  const dummy = new T.Object3D(),
    hullGeometry = new T.ConeGeometry(1.5, 5, 4),
    smokeGeometry = new T.IcosahedronGeometry(1);
  hullGeometry.rotateX(Math.PI / 2);
  const hullPaint = new T.MeshBasicMaterial(),
    smokePaint = new T.MeshBasicMaterial({
      color: 0x282c30,
      transparent: true,
      opacity: 0.8,
    });
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let damaged = [];
  function paintSmoke(time) {
    damaged.forEach((u, j) => {
      for (let i = 0; i < 3; i++) {
        const phase = reduceMotion
          ? (i + 0.5) / 3
          : (time / 2400 + i / 3 + j * 0.17) % 1;
        dummy.position.set(u.x + phase * 3, 2 + phase * 10, u.y);
        dummy.scale.setScalar(0.7 + phase * 1.8);
        dummy.updateMatrix();
        smoke.setMatrixAt(j * 3 + i, dummy.matrix);
      }
    });
    if (smoke) smoke.instanceMatrix.needsUpdate = true;
  }
  function animate(time) {
    active = false;
    if (!renderer || !damaged.length) return;
    paintSmoke(time);
    schedule();
    if (!reduceMotion) {
      active = true;
      requestAnimationFrame(animate);
    }
  }
  let initialized = false;
  window.amaRenderObservation = (source, units, name) => {
    if (source) {
      if (!initialized) {
        load(readWorld(source), name ?? "推演", false);
        initialized = true;
      } else {
        terrain = readWorld(source);
        layer = createSurfaceLayer(terrain);
        updateReference();
        clearTiles();
        drawReference();
        if (selection) select(selection.x, selection.y);
      }
    }
    if (hulls) {
      scene.remove(hulls, smoke);
      hulls.dispose();
      smoke.dispose();
    }
    setNames(units);
    damaged = units.filter((u) => u.heavy);
    el("liveUnits").hidden = false;
    el("liveUnits").textContent =
      "可见舰船 " + units.length + " · 大破冒烟 " + damaged.length;
    hulls = new T.InstancedMesh(hullGeometry, hullPaint, units.length);
    smoke = new T.InstancedMesh(smokeGeometry, smokePaint, damaged.length * 3);
    smoke.frustumCulled = false;
    for (const [i, u] of units.entries()) {
      dummy.position.set(u.x, 1, u.y);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      hulls.setMatrixAt(i, dummy.matrix);
      hulls.setColorAt(i, new T.Color(u.side === "ally" ? 0x68bdff : 0xf6a466));
    }
    scene.add(hulls, smoke);
    paintSmoke(0);
    schedule();
    if (!active && damaged.length && renderer && !reduceMotion) {
      active = true;
      requestAnimationFrame(animate);
    }
  };
}
