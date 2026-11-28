import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const result = await build({
  entryPoints: ["main.js"],
  bundle: true,
  minify: true,
  format: "iife",
  write: false,
  legalComments: "inline",
});
const page = await readFile("template.html", "utf8");
await mkdir("dist", { recursive: true });
await writeFile(
  "dist/AMA-Terrain.html",
  page.replace(
    '<script type="module" src="./main.js"></script>',
    () =>
      "<script>" +
      result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script") +
      "</script>",
  ),
);
// The browser edition and the desktop shell load the exact same viewer.
await writeFile(
  "../../tactical-map/terrain-3d.html",
  await readFile("dist/AMA-Terrain.html"),
);
