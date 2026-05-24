const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, Notification } = require("electron");
const path = require("path");
const { OllamaManager } = require("./ollama-manager");
const { BotManager } = require("./bot-manager");
const { CoordinatorServer } = require("./coordinator");
const { ConfigManager } = require("./config-manager");
const AnkaRecorder = require("./anka-recorder");
const log = require("electron-log");

log.initialize({ preload: true });
log.transports.file.level = "debug";

const isDev = process.env.NODE_ENV === "development";

let mainWindow = null;
let overlayWindow = null;
let ollamaManager = null;
let botManager = null;
let coordinatorServer = null;
let configManager = null;
let ankaRecorder = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#05070f",
    titleBarStyle: "default",
    title: "Призмарин Бот v4.1.4",
    icon: path.join(__dirname, "../../assets/icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js"),
      webSecurity: !isDev,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3456");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  // F12 перехватываем через before-input-event (работает даже когда DevTools активны)
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F12" && !input.control && !input.alt && !input.shift) {
      event.preventDefault();
      toggleOverlay();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.focus();
    return;
  }
  overlayWindow = new BrowserWindow({
    width: 260,
    height: 340,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/overlay-preload.js"),
    },
  });
  overlayWindow.loadFile(path.join(__dirname, "overlay.html"));
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.on("closed", () => { overlayWindow = null; });
}

function toggleOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (overlayWindow.isVisible()) overlayWindow.hide();
    else overlayWindow.show();
  } else {
    createOverlayWindow();
  }
}

function broadcast(event, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, data);
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send(event, data);
}

async function initialize() {
  configManager = new ConfigManager();
  ollamaManager = new OllamaManager(configManager);
  botManager = new BotManager(configManager, ollamaManager, (event, data) => {
    broadcast(event, data);

    // Уведомление о смерти бота (Windows/macOS/Linux системное уведомление)
    if (event === "bot:death") {
      try {
        const nick = data?.config?.nick || data?.botId || "Бот";
        const notif = new Notification({
          title: "💀 Бот погиб!",
          body: nick + " умер на сервере",
          silent: false,
        });
        notif.show();
      } catch {}
    }
  });
  coordinatorServer = new CoordinatorServer(botManager, (event, data) => {
    if (mainWindow) mainWindow.webContents.send(event, data);
  });

  ankaRecorder = new AnkaRecorder();
  setupIpcHandlers();
  await coordinatorServer.start();
}

function setupIpcHandlers() {
  ipcMain.handle("config:get", () => configManager.getAll());
  ipcMain.handle("config:set", (_e, key, value) => configManager.set(key, value));
  ipcMain.handle("config:setGlobalPassword", (_e, password) =>
    configManager.setGlobalPassword(password)
  );
  ipcMain.handle("config:getGlobalPassword", () =>
    configManager.getGlobalPassword()
  );

  ipcMain.handle("ollama:check", () => ollamaManager.checkOllama());
  ipcMain.handle("ollama:install", () => ollamaManager.installOllama());
  ipcMain.handle("ollama:listModels", () => ollamaManager.listModels());
  ipcMain.handle("ollama:listInstalledModels", () => ollamaManager.listInstalledModels());
  ipcMain.handle("ollama:pullModel", (_e, modelName) =>
    ollamaManager.pullModel(modelName, (progress) => {
      if (mainWindow)
        mainWindow.webContents.send("ollama:pullProgress", { modelName, progress });
    })
  );
  ipcMain.handle("ollama:deleteModel", (_e, modelName) =>
    ollamaManager.deleteModel(modelName)
  );
  ipcMain.handle("ollama:chat", (_e, params) => ollamaManager.chat(params));
  ipcMain.handle("ollama:getRunningModels", () => ollamaManager.getRunningModels());
  ipcMain.handle("ollama:loadCustomModel", (_e, filePath) =>
    ollamaManager.loadCustomModel(filePath)
  );

  ipcMain.handle("bot:create", (_e, config) => botManager.createBot(config));
  ipcMain.handle("bot:connect", (_e, botId) => botManager.connectBot(botId));
  ipcMain.handle("bot:disconnect", (_e, botId) => botManager.disconnectBot(botId));
  ipcMain.handle("bot:delete", (_e, botId) => botManager.deleteBot(botId));
  ipcMain.handle("bot:sendChat", (_e, botId, message) =>
    botManager.sendChat(botId, message)
  );
  ipcMain.handle("bot:sendAIOnly", (_e, botId, message) =>
    botManager.sendAIOnly(botId, message)
  );
  ipcMain.handle("bot:stopAction", (_e, botId) => botManager.stopAction(botId));
  ipcMain.handle("bot:stopMovement", (_e, botId) => botManager.stopMovement(botId));
  ipcMain.handle("bot:startSurvivor", (_e, botId) =>
    botManager.startSurvivorMode(botId)
  );
  ipcMain.handle("bot:stopSurvivor", (_e, botId) => botManager.stopSurvivorMode(botId));
  ipcMain.handle("bot:setNick", (_e, botId, nick) =>
    botManager.setNick(botId, nick)
  );
  ipcMain.handle("bot:toggleAI", (_e, botId, enabled) =>
    botManager.toggleAI(botId, enabled)
  );
  ipcMain.handle("bot:getAll", () => botManager.getAllBots());
  ipcMain.handle("bot:updateConfig", (_e, botId, config) =>
    botManager.updateBotConfig(botId, config)
  );
  ipcMain.handle("bot:testProxy", (_e, proxy) => botManager.testProxy(proxy));

  ipcMain.handle("bot:runTask", (_e, botId, taskName, args) =>
    botManager.runBotTask(botId, taskName, args)
  );
  ipcMain.handle("bot:stopTask", (_e, botId) =>
    botManager.stopBotTask(botId)
  );

  ipcMain.handle("bot:triggerLobby", (_e, botId) => botManager.triggerLobbyRank(botId));

  ipcMain.handle("proxy:check", (_e, proxy) => botManager.testProxy(proxy));

  ipcMain.handle("bot:startAnarchy", (_e, botId, opts) =>
    botManager.startAnarchyProtocol(botId, opts)
  );
  ipcMain.handle("bot:stopAnarchy", (_e, botId) =>
    botManager.stopAnarchyProtocol(botId)
  );
  ipcMain.handle("bot:getAnarchyState", (_e, botId) =>
    botManager.getAnarchyState(botId)
  );

  ipcMain.handle("dialog:openFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "GGUF Model", extensions: ["gguf"] }],
    });
    return result.filePaths[0] || null;
  });

  // ── Рекордер анки ──────────────────────────────────────────────────────────
  ipcMain.handle("anka:list", () => ankaRecorder.listProfiles());
  ipcMain.handle("anka:startRecording", (_e, botId) => ankaRecorder.startRecording(botId));
  ipcMain.handle("anka:addStep", (_e, botId, step) => ankaRecorder.addStep(botId, step));
  ipcMain.handle("anka:stopRecording", (_e, botId, info) => ankaRecorder.stopRecording(botId, info));
  ipcMain.handle("anka:cancelRecording", (_e, botId) => ankaRecorder.cancelRecording(botId));
  ipcMain.handle("anka:getStepCount", (_e, botId) => ankaRecorder.getStepCount(botId));
  ipcMain.handle("anka:isRecording", (_e, botId) => ankaRecorder.isRecording(botId));
  ipcMain.handle("anka:delete", (_e, id) => ankaRecorder.deleteProfile(id));
  ipcMain.handle("anka:play", async (_e, botId, profileId) => {
    const profile = ankaRecorder.getProfile(profileId);
    if (!profile) throw new Error("Профиль не найден");
    return botManager.playAnkaProfile(botId, profile.steps);
  });
  ipcMain.handle("anka:clickSlot", async (_e, botId, slot, button) =>
    botManager.clickBotSlot(botId, slot, button)
  );
  ipcMain.handle("shell:openExternal", (_e, url) => shell.openExternal(url));

  ipcMain.handle("overlay:close", () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  });
}

app.whenReady().then(async () => {
  await initialize();
  createWindow();

  // F12 — показать/скрыть оверлей поверх всех окон
  globalShortcut.register("F12", () => toggleOverlay());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  await botManager?.disconnectAll();
  await coordinatorServer?.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await botManager?.disconnectAll();
});
