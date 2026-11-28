// Supply the executable path. For an unpackaged Electron runtime also supply the app directory.
// Uses an isolated user profile and checks two independent desktop process launches.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import { createRequire } from "node:module";
import { source, ship } from "../../tests/fixtures.mjs";
const require = createRequire(
  new URL("../baseline/package.json", import.meta.url),
);
const { default: puppeteer } = await import(pathToFileURL(require.resolve("puppeteer-core")).href);
const rendererErrors=[];
const [exe, appDir] = process.argv.slice(2);
const profile = await mkdtemp(path.join(tmpdir(), "ama-desktop-"));
async function start() {
  const browser = await puppeteer.launch({
    executablePath: exe,
    ignoreDefaultArgs: true,
    headless: false,
    userDataDir: profile,
    args: [
      ...(process.env.AMA_TEST_ARGS
        ? JSON.parse(process.env.AMA_TEST_ARGS)
        : []),
      "--remote-debugging-port=0",
      "--user-data-dir=" + profile,
      ...(appDir ? [appDir] : []),
    ],
    timeout: 45000,
  });
  const target = await browser.waitForTarget(
    (t) => t.url() === "ama://game/tactical-map/",
  );
  const page = await target.page();
  page.on("pageerror", (e) => rendererErrors.push(e.message));
  await page.waitForSelector("#editor button");
  return { browser, page };
}
let browser, page, id;
try {
  ({ browser, page } = await start());
  const scenario = source();
  const damaged = ship("damaged", "ally", 20);
  damaged.currentHp = 0;
  scenario.instances.push(damaged);
  id = await page.evaluate(async (scene) => {
    const { createSimulation, openSimulation } =
      await import("./simulation-store.js?v=visual-support-bridge-1");
    const id = await createSimulation(scene, () => ({ valid: true }));
    const sim = await openSimulation(id);
    await sim.beginMovement();
    await sim.planMovement({ kind: "unit", id: "a" }, 1, 0);
    await sim.resolveMovement();
    return id;
  }, scenario);
  await browser.close();
  ({ browser, page } = await start());
  await page.goto(
    "ama://game/tactical-map/simulation.html?id=" + encodeURIComponent(id),
  );
  await page.waitForFunction(() =>
    document
      .querySelector("#title")
      ?.textContent.includes("Performance regression"),
  );
  const state = await page.evaluate(async (id) => {
    const { openSimulation } =
      await import("./simulation-store.js?v=visual-support-bridge-1");
    const sim = await openSimulation(id),
      scene = sim.getSceneSnapshot();
    return [
      scene.turn.phaseId,
      scene.instances.find((u) => u.instanceId === "a").x,
    ];
  }, id);
  assert.deepEqual(state, ["order-5", 1]);
  await page.waitForSelector('[data-instance-id="damaged"] .damage-smoke');
  await page.click("#showTerrain3d");
  const frame = await (await page.$("#terrainFrame")).contentFrame();
  await frame.waitForSelector("#status");
  await frame.waitForSelector("#view canvas");
  await frame.waitForFunction(() =>
    document
      .querySelector("#status")
      .textContent.includes("Performance regression"),
  );
  await frame.waitForFunction(() =>
    document.querySelector("#liveUnits")?.textContent.includes("大破冒烟 1"),
  );
  await page.click("#closeTerrain");
  await page.waitForFunction(
    () => !document.querySelector("#terrainDialog").open,
  );
  assert.deepEqual(rendererErrors,[]);
  console.log(
    "PASS desktop editor, simulation movement, exit, cold restart, persisted position/phase and 3D view",
  );
} finally {
  if (browser?.connected) await browser.close();
}
