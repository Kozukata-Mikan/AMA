import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const base = process.env.AMA_URL ?? "http://127.0.0.1:8908";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  args: process.env.CHROME_ARGS ? JSON.parse(process.env.CHROME_ARGS) : [],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.click('button[data-view="tactical-map"]');
  const frame = await (await page.$("#map-frame")).contentFrame();
  await frame.waitForSelector("#editor button");
  const sample = await frame.evaluate(async () => {
    const { createDemoTerrain } = await import("./terrain-data.js");
    const terrain = createDemoTerrain();
    terrain.heights.fill(2);
    return JSON.stringify({ terrain });
  });
  const exportText = () =>
    page.evaluate(async () => {
      const create = URL.createObjectURL,
        click = HTMLAnchorElement.prototype.click;
      let blob;
      try {
        URL.createObjectURL = (value) => {
          blob = value;
          return create.call(URL, value);
        };
        HTMLAnchorElement.prototype.click = function () {};
        document.querySelector("#export").click();
        return await blob.text();
      } finally {
        URL.createObjectURL = create;
        HTMLAnchorElement.prototype.click = click;
      }
    });

  const restoreText = async (saved) => {
    await page.click("#demo");
    await page.$eval(
      "#file",
      (input, text) => {
        const dt = new DataTransfer();
        dt.items.add(new File([text], "restored.json"));
        input.files = dt.files;
        input.dispatchEvent(new Event("change"));
      },
      saved,
    );
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("restored.json"),
    );
  };
  for (const url of [
    base + "/prototype/terrain/dist/AMA-Terrain.html",
    new URL("../terrain/dist/AMA-Terrain.html", import.meta.url).href,
  ]) {
    await page.setOfflineMode(url.startsWith("file:"));
    await page.goto(url);
    await page.waitForSelector("#view canvas");
    await page.click("#port");
    assert.match(await page.$eval("#point", (e) => e.textContent), /高程/);
    await page.$eval("#scale", (e) => {
      e.value = "4";
      e.dispatchEvent(new Event("input"));
    });
    assert.equal(await page.$eval("#factor", (e) => e.textContent), "4×");
    await page.$eval(
      "#file",
      (input, scene) => {
        const data = new DataTransfer();
        data.items.add(
          new File([scene], "sample.json", { type: "application/json" }),
        );
        input.files = data.files;
        input.dispatchEvent(new Event("change"));
      },
      sample,
    );
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("sample.json"),
    );
    await page.click("#map");
    assert.match(await page.$eval("#point", (e) => e.textContent), /200 m/);
    assert.equal(await page.$eval("#port", (e) => e.hidden), true);
    await page.select("#brush", "desert");
    await page.click("#apply");
    assert.match(
      await page.$eval("#point", (e) => e.textContent),
      /沙漠.*200 m/,
    );
    await page.select("#brush", "lower");
    await page.click("#apply");
    assert.match(
      await page.$eval("#point", (e) => e.textContent),
      /沙漠.*100 m/,
    );
    await page.click("#undo");
    assert.match(
      await page.$eval("#point", (e) => e.textContent),
      /沙漠.*200 m/,
    );
    const saved = await exportText();
    await restoreText(saved);
    await page.click("#map");
    assert.match(
      await page.$eval("#point", (e) => e.textContent),
      /沙漠.*200 m/,
    );
    await page.click("#large");
    assert.match(
      await page.$eval("#status", (n) => n.textContent),
      /14401 × 14401/,
    );
    const corner = async () => {
      await page.$eval("#coordX", (n) => {
        n.value = "7200";
      });
      await page.$eval("#coordY", (n) => {
        n.value = "7200";
      });
      await page.click("#locate button");
    };
    await corner();
    const before = await page.$eval("#point", (n) => n.textContent);
    await page.select("#radius", "0");
    await page.select("#brush", "raise");
    await page.click("#apply");
    const after = await page.$eval("#point", (n) => n.textContent);
    assert.match(after, /7200.00.*7200.00/);
    assert.notEqual(after, before);
    const largeSaved = await exportText();
    assert.equal(
      JSON.parse(largeSaved).surfaceLayer.cells[0][0],
      14401 ** 2 - 1,
    );
    await restoreText(largeSaved);
    await corner();
    assert.equal(await page.$eval("#point", (n) => n.textContent), after);
    console.log(
      "Large world single-cell project bytes:",
      Buffer.byteLength(largeSaved),
    );
    await page.click("#home");
    await page.click("#demo");
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("示例岛屿"),
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS original homepage and editor, HTTP and offline file terrain entries",
  );
} finally {
  await browser.close();
}
