// Run against an unmodified simulation page served from repository root.
// Install puppeteer-core separately; optionally set CHROME_PATH and PROFILE.
import puppeteer from "puppeteer-core";
import fs from "node:fs/promises";
const args = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-background-timer-throttling",
];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  args,
  headless: true,
  userDataDir: process.env.PROFILE,
  protocolTimeout: 0,
});
const base = process.env.AMA_URL ?? "http://localhost:8908",
  marks = new Set([1, 10, 25, 50, 100]),
  rows = [];
const openPage = async () => {
  const p = await browser.newPage();
  await p.evaluateOnNewDocument(() => {
    window.writeMs = 0;
    const tx = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...a) {
      const t = tx.apply(this, a);
      if (t.mode === "readwrite") {
        const s = performance.now();
        t.addEventListener(
          "complete",
          () => (window.writeMs += performance.now() - s),
        );
      }
      return t;
    };
  });
  await p.goto(base + "/prototype/baseline/fixture.js");
  return p;
};
try {
  let p = await openPage();
  const moving = process.env.SCENARIO === "moving";
  const id = await p.evaluate(async (moving) => {
    const { fleetFixture, movingFleet } = await import("./fixture.js");
    const { createSimulation } =
      await import("/tactical-map/simulation-store.js?v=visual-support-bridge-1");
    return createSimulation(moving ? movingFleet() : fleetFixture(), () => ({
      valid: true,
    }));
  }, moving);
  const reopen = async () =>
    p.evaluate(async (id) => {
      const s = performance.now();
      const { openSimulation } =
        await import("/tactical-map/simulation-store.js?v=visual-support-bridge-1");
      window.sim = await openSimulation(id);
      sim.getSceneSnapshot();
      return {
        ms: performance.now() - s,
        turn: sim.getSceneSnapshot().turn.number,
      };
    }, id);
  await reopen();
  for (let round = 1; round <= 101; round++) {
    const row = await p.evaluate(
      async ({ round, id, moving }) => {
        const start = performance.now();
        window.writeMs = 0;
        await sim.beginMovement();
        const positions = moving
          ? sim.getSceneSnapshot().instances.map((u) => u.x)
          : null;
        if (moving)
          await sim.planMovement(
            { kind: "group", id: "fleet" },
            6000 + round,
            6000,
          );
        await sim.resolveMovement();
        const moved = moving
          ? sim
              .getSceneSnapshot()
              .instances.filter((u, i) => u.x !== positions[i]).length
          : 0;
        if (moving && moved !== 200)
          throw Error("Moved " + moved + " units at round " + round);
        for (let i = 0; i < 6; i++)
          await sim.settleAttackPhase(sim.getSceneSnapshot().revision);
        await sim.finishSpecialPhase(sim.getSceneSnapshot().revision);
        await sim.finishTurn(sim.getSceneSnapshot().revision);
        const ms = performance.now() - start,
          writeMs = window.writeMs;
        const { readSave } = await import("/js/save-database.js");
        const bytes = new Blob([await readSave("junqi-simulation-v1:" + id)])
          .size;
        return { round, ms, writeMs, bytes, ...(moving ? { moved } : {}) };
      },
      { round, id, moving },
    );
    if (marks.has(round)) {
      await p.close();
      p = await openPage();
      const result = await reopen();
      if (result.turn !== round + 1) throw Error("Reopen mismatch");
      row.reopenMs = result.ms;
    }
    rows.push(row);
    await fs.writeFile(
      process.env.RESULT ?? "baseline.json",
      JSON.stringify({ browser: await browser.version(), rows }, null, 2),
    );
    console.log(JSON.stringify(row));
  }
} finally {
  await browser.close();
}
