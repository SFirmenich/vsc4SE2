const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let backendProcess = null;

function backendExecutablePath() {
  if (!app.isPackaged) {
    return {
      command: "python",
      args: ["desktop_server.py"],
      cwd: path.resolve(__dirname, "..", "..", "backend"),
    };
  }

  const resourcesBackend = path.join(process.resourcesPath, "backend");
  const exe = process.platform === "win32"
    ? path.join(resourcesBackend, "vsc4education-repository-backend.exe")
    : path.join(resourcesBackend, "vsc4education-repository-backend");
  return { command: exe, args: [], cwd: resourcesBackend };
}

function startBackend() {
  const backend = backendExecutablePath();
  const dataDir = path.join(app.getPath("userData"), "data");

  backendProcess = spawn(backend.command, backend.args, {
    cwd: backend.cwd,
    env: {
      ...process.env,
      VSC4EDU_REPOSITORY_DATA_DIR: dataDir,
      VSC4EDU_REPOSITORY_DESKTOP: "1",
    },
    windowsHide: true,
    stdio: app.isPackaged ? "ignore" : "inherit",
  });

  backendProcess.on("error", (error) => {
    dialog.showErrorBox("Backend startup failed", String(error));
  });
}

async function waitForBackend() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:8000/api/users/me/");
      if (response.ok) {
        return;
      }
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("The local backend did not respond on http://127.0.0.1:8000");
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: "VSCode4Education Repository",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    win.loadURL("http://127.0.0.1:5173");
    win.webContents.openDevTools({ mode: "detach" });
    return;
  }

  win.loadFile(path.join(__dirname, "..", "frontend", "index.html"));
}

app.whenReady().then(async () => {
  startBackend();
  try {
    await waitForBackend();
  } catch (error) {
    dialog.showErrorBox("VSCode4Education Repository", String(error));
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
