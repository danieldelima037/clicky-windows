import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from "electron";
import { createTray } from "./tray";
import { HotkeyManager } from "./hotkey";
import { AudioCapture } from "./audio";
import { SettingsStore } from "./settings";
import { CompanionManager } from "./companion";
import path from "path";

let chatWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let overlayWindows: BrowserWindow[] = [];

const settings = new SettingsStore();
let companion: CompanionManager;
let audioCapture: AudioCapture;
let cursorBuddyInterval: ReturnType<typeof setInterval> | null = null;

function startCursorBuddy(): void {
  if (cursorBuddyInterval) return;
  cursorBuddyInterval = setInterval(() => {
    if (overlayWindows.length === 0) return;
    const point = screen.getCursorScreenPoint();
    const target = screen.getDisplayNearestPoint(point);
    const displays = screen.getAllDisplays();
    const targetIndex = displays.findIndex((d) => d.id === target.id);
    for (let i = 0; i < overlayWindows.length; i++) {
      const win = overlayWindows[i];
      if (!win || win.isDestroyed()) continue;
      if (i === targetIndex) {
        const localX = point.x - target.bounds.x;
        const localY = point.y - target.bounds.y;
        win.webContents.send("overlay:cursor-buddy", localX, localY);
      } else {
        win.webContents.send("overlay:cursor-buddy-visible", false);
      }
    }
  }, 33);
}

function stopCursorBuddy(): void {
  if (cursorBuddyInterval) {
    clearInterval(cursorBuddyInterval);
    cursorBuddyInterval = null;
  }
  for (const win of overlayWindows) {
    if (win && !win.isDestroyed()) {
      win.webContents.send("overlay:cursor-buddy-visible", false);
    }
  }
}

function createOverlayWindows(): BrowserWindow[] {
  return screen.getAllDisplays().map((display, i) => createOverlayWindow(display, i));
}

function createOverlayWindow(display: Electron.Display, displayIndex: number): BrowserWindow {
  const { x, y, width, height } = display.bounds;

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, "screen-saver");
  win.loadFile(path.join(__dirname, "..", "..", "src", "renderer", "overlay", "index.html"));

  win.webContents.on("console-message", (_event, level, message, line) => {
    console.log(`[overlay${displayIndex}:${level}] ${message} (line ${line})`);
  });

  if (!app.isPackaged && displayIndex === 0) {
    win.webContents.once("did-finish-load", () => {
      win.webContents.openDevTools({ mode: "detach" });
    });
  }

  win.once("ready-to-show", () => {
    win.showInactive();
    win.setAlwaysOnTop(true, "screen-saver");
    console.log(`[Clicky] Overlay ${displayIndex} shown:`, win.getBounds(), "isVisible:", win.isVisible());
  });

  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      win.showInactive();
      win.setAlwaysOnTop(true, "screen-saver");
      console.log(`[Clicky] Overlay ${displayIndex} forced-shown after did-finish-load:`, win.getBounds());
    }
  });

  return win;
}

function createChatWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 550,
    resizable: true,
    show: false,
    frame: false,
    transparent: false,
    alwaysOnTop: settings.get("alwaysOnTop"),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "..", "..", "src", "renderer", "chat", "index.html"));
  win.webContents.on("console-message", (_event, level, message, line) => {
    console.log(`[chat:${level}] ${message} (line ${line})`);
  });
  win.once("ready-to-show", () => {
    win.show();
    if (settings.get("alwaysOnTop")) {
      win.setAlwaysOnTop(true, "screen-saver");
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.setAlwaysOnTop(true, "screen-saver");
        }
      }, 500);
    }
  });
  return win;
}

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 500,
    height: 600,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "..", "..", "src", "renderer", "settings", "index.html"));
  win.webContents.on("console-message", (_event, level, message, line) => {
    console.log(`[settings:${level}] ${message} (line ${line})`);
  });
  win.once("ready-to-show", () => win.show());
  return win;
}

function setupIPC(): void {
  ipcMain.handle("chat:query", async (_event, text: string) => {
    try {
      const response = await companion.processQuery(text);
      return response;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(msg);
    }
  });

  ipcMain.handle("companion:clearHistory", () => {
    companion.clearHistory();
  });

  ipcMain.handle("companion:cancelQuery", () => {
    companion.cancelQuery();
  });

  ipcMain.handle("settings:getAll", () => settings.getAll());
  ipcMain.handle("settings:set", (_event, key: string, value: unknown) => {
    const allSettings = settings.getAll();
    const typedKey = key as keyof typeof allSettings;
    if (typedKey in allSettings) {
      settings.set(typedKey, value as typeof allSettings[typeof typedKey]);
    }

    if (key === "alwaysOnTop" && chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.setAlwaysOnTop(!!value, "screen-saver");
    }

    if (key === "cursorBuddyEnabled") {
      if (value) startCursorBuddy();
      else stopCursorBuddy();
    }
  });

  ipcMain.handle("settings:batchSet", (_event, pairs: Array<[string, unknown]>) => {
    const allSettings = settings.getAll();
    for (const [key, value] of pairs) {
      const typedKey = key as keyof typeof allSettings;
      if (typedKey in allSettings) {
        settings.set(typedKey, value as typeof allSettings[typeof typedKey]);
      }
    }
  });

  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    if (url.startsWith("https://")) {
      shell.openExternal(url);
    } else {
      console.warn(`[Clicky] Blocked non-HTTPS openExternal: ${url}`);
    }
  });

  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

function recreateOverlays(): void {
  overlayWindows.forEach((w) => { if (!w.isDestroyed()) w.close(); });
  overlayWindows = createOverlayWindows();
  companion.updateOverlayWindows(overlayWindows);
}

app.whenReady().then(() => {
  app.dock?.hide?.();

  overlayWindows = createOverlayWindows();
  companion = new CompanionManager(settings, overlayWindows);
  audioCapture = new AudioCapture(settings);
  audioCapture.setCompanion(companion);

  setupIPC();

  const tray = createTray({
    onChat: () => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.focus();
      } else {
        chatWindow = createChatWindow();
        chatWindow.on("closed", () => {
          chatWindow = null;
        });
      }
    },
    onSettings: () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
      } else {
        settingsWindow = createSettingsWindow();
        settingsWindow.on("closed", () => {
          settingsWindow = null;
        });
      }
    },
    onClearHistory: () => {
      companion.clearHistory();
      console.log("[Clicky] Conversation history cleared");
    },
    onQuit: () => app.quit(),
  });

  const hotkeyManager = new HotkeyManager(settings);
  hotkeyManager.register();

  chatWindow = createChatWindow();
  chatWindow.on("closed", () => {
    chatWindow = null;
  });

  if (settings.get("cursorBuddyEnabled")) {
    startCursorBuddy();
  }

  screen.on("display-added", () => {
    console.log("[Clicky] Display added — recreating overlay windows");
    recreateOverlays();
  });

  screen.on("display-removed", () => {
    console.log("[Clicky] Display removed — recreating overlay windows");
    recreateOverlays();
  });

  console.log("Clicky Windows started — running in system tray");
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
});
