import { projectMap } from './map-display.js';

const NS = 'http://www.w3.org/2000/svg';
const LAND = ['#52705e', '#607a60', '#718366', '#8b8f72', '#a4a187', '#c1bba3'];
const LEVELS = [10, 30, 60, 120, 240];
const pathPoint = p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;

function node(tag, attributes, parent) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  parent.append(element);
  return element;
}

// This is display geometry only. Never write interpolated/coarser values to terrain.
function clipAtHeight(vertices, level, above) {
  const result = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const insideA = above ? a.z > level : a.z <= level;
    const insideB = above ? b.z > level : b.z <= level;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = (level - a.z) / (b.z - a.z);
      result.push({x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t, z: level});
    }
  }
  return result;
}

function contourSegment(triangle, level) {
  const points = [];
  for (let i = 0; i < 3; i++) {
    const a = triangle[i], b = triangle[(i + 1) % 3];
    if ((a.z < level) === (b.z < level)) continue;
    const t = (level - a.z) / (b.z - a.z);
    points.push(projectMap(a.x + (b.x-a.x)*t, a.y + (b.y-a.y)*t, Math.max(0, level)));
  }
  return points.length === 2 ? `M${pathPoint(points[0])}L${pathPoint(points[1])}` : '';
}

export function drawSimulationCartography(layer, terrain, grid, {colored = true} = {}) {
  const fragment = document.createDocumentFragment();
  let faces = new Map();
  const coast = [], contours = new Map(), rivers = [];
  let maximum = 0;
  for (const row of grid) for (const vertex of row) maximum = Math.max(maximum, vertex.z);
  // At most about twelve visible contour levels, independent of saved precision.
  const interval = terrain.contourInterval * Math.max(1, Math.ceil(maximum / terrain.contourInterval / 12));

  function flush() {
    for (const [color, polygons] of faces) for (let i = 0; i < polygons.length; i += 256) {
      // Matching half-pixel edges cover SVG anti-alias cracks between batches.
      node('path', {d: polygons.slice(i,i+256).join(''), fill: color, stroke: color,
        'stroke-width': '.55', 'stroke-linejoin': 'round',
        'vector-effect': 'non-scaling-stroke', class: 'chart-face'}, fragment);
    }
    faces = new Map();
  }
  function face(vertices, nextColor) {
    if (vertices.length < 3) return;
    const points = vertices.map(v => projectMap(v.x, v.y, Math.max(0, v.z)));
    // Uniform winding keeps overlapping subpaths from cutting holes in a batch.
    const area = points.reduce((sum, a, i) => {
      const b = points[(i+1)%points.length]; return sum + a.x*b.y - b.x*a.y;
    }, 0);
    if (area < 0) points.reverse();
    if (!faces.has(nextColor)) faces.set(nextColor, []);
    faces.get(nextColor).push(`M${points.map(pathPoint).join('L')}Z`);
  }

  for (let r = 0; r < grid.length-1; r++) {
   for (let c = 0; c < grid[r].length-1; c++) {
    const a = grid[r][c], b = grid[r][c+1], d = grid[r+1][c], e = grid[r+1][c+1];
    for (const triangle of [[a,b,e], [a,e,d]]) {
      const water = clipAtHeight(triangle, 0, false);
      const land = clipAtHeight(triangle, 0, true);
      const shallow = triangle.some(v => v.kind === 'shallow');
      face(water, !colored ? '#102735' : shallow ? '#2a6470' : '#153b4c');
      if (!colored) face(land, '#233e42');
      else if (land.length) {
        const low = Math.min(...land.map(v => v.z)), high = Math.max(...land.map(v => v.z));
        for (let band = 0; band < LAND.length; band++) {
          const floor = band === 0 ? 0 : LEVELS[band-1], ceiling = LEVELS[band] ?? Infinity;
          if (high <= floor || low > ceiling) continue;
          let part = low <= floor ? clipAtHeight(land, floor, true) : land;
          if (high > ceiling) part = clipAtHeight(part, ceiling, false);
          face(part, LAND[band]);
        }
      }
      const shoreline = contourSegment(triangle, 0);
      if (shoreline) coast.push(shoreline);
      const low = Math.min(...triangle.map(v => v.z));
      const high = Math.max(...triangle.map(v => v.z));
      for (let level = Math.max(interval, (Math.floor(low / interval)+1)*interval); level <= high; level += interval) {
        const segment = contourSegment(triangle, level);
        if (!segment) continue;
        if (!contours.has(level)) contours.set(level, []);
        contours.get(level).push(segment);
      }
    }
   }
   // Batch equal colors within a row, keeping foreground rows in painter order.
   flush();
  }
  flush();
  // Include isolated and edge vertices, not only rivers spanning a full triangle.
  for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) {
    const vertex = grid[r][c];
    if (vertex.kind !== 'river') continue;
    const point = projectMap(vertex.x,vertex.y,Math.max(0,vertex.z));
    rivers.push(`M${pathPoint(point)}l0.01,0`);
    for (const neighbor of [grid[r][c+1], grid[r+1]?.[c]]) if (neighbor?.kind === 'river') {
      rivers.push(`M${pathPoint(point)}L${pathPoint(projectMap(neighbor.x,neighbor.y,Math.max(0,neighbor.z)))}`);
    }
  }
  for (const [level, segments] of contours) node('path', {
    d: segments.join(''), fill: 'none', class: level % (interval*3) === 0 ? 'chart-contour chart-contour-major' : 'chart-contour'
  }, fragment);
  if (rivers.length) node('path', {d:rivers.join(''), fill:'none', class:'chart-river'}, fragment);
  if (coast.length) {
    const d = coast.join('');
    node('path', {d, fill:'none', class:'chart-coast-halo'}, fragment);
    node('path', {d, fill:'none', class:'chart-coast'}, fragment);
  }
  layer.replaceChildren(fragment);
}
