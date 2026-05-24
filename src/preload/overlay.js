const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlayAPI", {
  getBots:       ()            => ipcRenderer.invoke("bot:getAll"),
  runTask:       (id, t, a)    => ipcRenderer.invoke("bot:runTask", id, t, a),
  stopTask:      (id)          => ipcRenderer.invoke("bot:stopTask", id),
  startAnarchy:  (id, opts)    => ipcRenderer.invoke("bot:startAnarchy", id, opts),
  stopAnarchy:   (id)          => ipcRenderer.invoke("bot:stopAnarchy", id),
  connect:       (id)          => ipcRenderer.invoke("bot:connect", id),
  disconnect:    (id)          => ipcRenderer.invoke("bot:disconnect", id),
  closeOverlay:  ()            => ipcRenderer.send("overlay:close"),

  on: (channel, cb) => {
    const allowed = [
      "bot:statusChanged", "bot:death", "bot:alert",
      "bot:taskStarted", "bot:taskStopped", "bot:survivorLog",
    ];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_e, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
