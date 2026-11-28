import { sampleWorld } from "./world.js";

export const surfaces = {
  grass: ["草地", "#82a476"],
  forest: ["林地", "#527758"],
  rock: ["岩地", "#9c9989"],
  snow: ["雪地", "#e4ecea"],
  desert: ["沙漠", "#dab472"],
  beach: ["沙滩", "#cfbe92"],
  sea: ["海面", "#326079"],
  shallow: ["浅水", "#568e99"],
  river: ["河流", "#6096a2"],
};
export const paintable = ["grass", "forest", "rock", "snow", "desert", "beach"];

export function createSurfaceLayer(t, saved) {
  const width = Math.ceil(t.width),
    rows = Math.ceil(t.height);
  const edits = new Map(),
    history = [];
  if (saved !== undefined) {
    if (saved?.version !== 1 || !Array.isArray(saved.cells))
      throw Error("地表图层格式无效");
    for (const cell of saved.cells) {
      if (!Array.isArray(cell) || cell.length !== 3)
        throw Error("地格数据无效");
      const [id, delta, cover] = cell;
      if (
        !Number.isSafeInteger(id) ||
        id < 0 ||
        id >= width * rows ||
        edits.has(id) ||
        !Number.isSafeInteger(delta) ||
        (cover !== null && !paintable.includes(cover))
      )
        throw Error("地格数据无效");
      edits.set(id, [delta, cover]);
    }
  }
  function coords(x, y) {
    return [
      Math.min(width - 1, Math.floor(x + t.width / 2)),
      Math.min(rows - 1, Math.floor(y + t.height / 2)),
    ];
  }
  function sample(x, y) {
    const base = sampleWorld(t, x, y);
    if (!base.inside) return base;
    const [i, j] = coords(x, y);
    const [delta, cover] = edits.get(j * width + i) ?? [0, null];
    const height = base.height + delta;
    let surface = cover;
    if (height <= 0) surface = base.kind === "shallow" ? "shallow" : "sea";
    else if (base.kind === "river") surface = "river";
    else if (!surface)
      surface =
        height < 3
          ? "beach"
          : height < 12
            ? "grass"
            : height < 24
              ? "forest"
              : height < 40
                ? "rock"
                : "snow";
    return { ...base, height, surface };
  }
  function apply(x, y, radius, action) {
    if (
      !sampleWorld(t, x, y).inside ||
      !Number.isInteger(radius) ||
      radius < 0 ||
      radius > 32
    )
      throw Error("笔刷超出范围");
    if (
      !paintable.includes(action) &&
      !["lower", "raise", "auto"].includes(action)
    )
      throw Error("笔刷类型无效");
    const [cx, cy] = coords(x, y),
      previous = [];
    for (
      let j = Math.max(0, cy - radius);
      j <= Math.min(rows - 1, cy + radius);
      j++
    ) {
      for (
        let i = Math.max(0, cx - radius);
        i <= Math.min(width - 1, cx + radius);
        i++
      ) {
        if ((i - cx) ** 2 + (j - cy) ** 2 > radius ** 2) continue;
        const id = j * width + i,
          old = edits.get(id),
          [delta, cover] = old ?? [0, null];
        const nextDelta =
          delta + (action === "raise" ? 1 : action === "lower" ? -1 : 0);
        const nextCover = paintable.includes(action)
          ? action
          : action === "auto"
            ? null
            : cover;
        if (delta === nextDelta && cover === nextCover) continue;
        previous.push([id, old]);
        if (nextDelta || nextCover) edits.set(id, [nextDelta, nextCover]);
        else edits.delete(id);
      }
    }
    if (previous.length) {
      const bounds = {
        x: cx - t.width / 2,
        y: cy - t.height / 2,
        r: radius + 1,
      };
      history.push({ previous, bounds });
      if (history.length > 50) history.shift();
      return bounds;
    }
  }
  return {
    sample,
    apply,
    get canUndo() {
      return history.length > 0;
    },
    undo() {
      const entry = history.pop();
      if (!entry) return;
      for (const [id, old] of entry.previous)
        if (old) edits.set(id, old);
        else edits.delete(id);
      return entry.bounds;
    },
    serialize() {
      return {
        version: 1,
        cells: Array.from(edits, ([id, [delta, cover]]) => [id, delta, cover]),
      };
    },
  };
}
