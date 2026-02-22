import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const DEFAULT_GATEWAY_TOKEN_ENV = "OPENCLAW_GATEWAY_TOKEN";

type SpawnedGateway = {
  process: ReturnType<typeof spawn>;
  token: string;
};

let gateway: SpawnedGateway | null = null;

function resolveGatewayUrl(): string {
  return process.env.MINDFLY_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL;
}

function resolveGatewayToken(): string {
  const raw = process.env.MINDFLY_GATEWAY_TOKEN?.trim();
  if (raw) {
    return raw;
  }
  return crypto.randomUUID();
}

function spawnGateway(token: string): SpawnedGateway | null {
  const cmd = process.env.MINDFLY_GATEWAY_COMMAND?.trim() || "openclaw";
  const args = (process.env.MINDFLY_GATEWAY_ARGS?.trim() || "")
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);

  const resolvedArgs =
    args.length > 0 ? args : ["gateway", "run", "--bind", "loopback", "--port", "18789", "--force"];

  try {
    const proc = spawn(cmd, resolvedArgs, {
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        [DEFAULT_GATEWAY_TOKEN_ENV]: token,
      },
    });
    return { process: proc, token };
  } catch {
    return null;
  }
}

async function createMainWindow(): Promise<BrowserWindow> {
  const preloadPath = path.join(app.getAppPath(), "dist", "preload.js");
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In V1 the Windows app loads the built Control UI bundle from disk.
  // This intentionally avoids serving HTML from the gateway process.
  const uiEntry = path.join(app.getAppPath(), "..", "..", "ui", "dist", "index.html");
  await win.loadFile(uiEntry);
  return win;
}

app.whenReady().then(async () => {
  const token = resolveGatewayToken();
  gateway = spawnGateway(token);

  ipcMain.handle("mindfly:get-gateway-token", async () => gateway?.token ?? token);
  ipcMain.handle("mindfly:get-gateway-url", async () => resolveGatewayUrl());

  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (gateway?.process && !gateway.process.killed) {
    gateway.process.kill();
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

