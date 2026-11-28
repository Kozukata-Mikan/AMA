const { app, BrowserWindow, Menu, protocol, net } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.join(__dirname, "web");
const home = "ama://game/tactical-map/";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "ama",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      allowServiceWorkers: true,
    },
  },
]);
const local = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "ama:" && parsed.host === "game";
  } catch {
    return false;
  }
};
function openWindow(url = home) {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 480,
    title: "AMA",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on("will-navigate", (event, address) => {
    if (!local(address)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (local(url)) openWindow(url);
    return { action: "deny" };
  });
  win.loadURL(url);
  return win;
}
app.setName("AMA");
if (!app.commandLine.hasSwitch("user-data-dir"))
  app.setPath("userData", path.join(app.getPath("appData"), "AMA-Desktop"));
app.whenReady().then(() => {
  protocol.handle("ama", (request) => {
    if (!local(request.url) || request.method !== "GET")
      return new Response(null, { status: 404 });
    let name;
    try {
      name = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (name.endsWith("/")) name += "index.html";
    if (name.includes("\\") || name.includes(":") || name.includes("\0"))
      return new Response(null, { status: 400 });
    const file = path.resolve(root, "." + name);
    if (!file.startsWith(root + path.sep))
      return new Response(null, { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "AMA",
        submenu: [
          { label: "作戦エディター", click: () => openWindow() },
          {
            label: "地形エディター",
            click: () => openWindow("ama://game/tactical-map/terrain-3d.html"),
          },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
    ]),
  );
  openWindow();
});
app.on("window-all-closed", () => app.quit());
