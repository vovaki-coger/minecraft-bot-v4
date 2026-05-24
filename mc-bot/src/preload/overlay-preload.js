const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlayAPI", {
  getAll:       ()          => ipcRenderer.invoke("bot:getAll"),
  connect:      (id)        => ipcRenderer.invoke("bot:connect", id),
  disconnect:   (id)        => ipcRenderer.invoke("bot:disconnect", id),
  runTask:      (id, t, a)  => ipcRenderer.invoke("bot:runTask", id, t, a),
  stopTask:     (id)        => ipcRenderer.invoke("bot:stopTask", id),
  startAnarchy: (id, opts)  => ipcRenderer.invoke("bot:startAnarchy", id, opts),
  stopAnarchy:  (id)        => ipcRenderer.invoke("bot:stopAnarchy", id),
  closeOverlay: ()          => ipcRenderer.invoke("overlay:close"),
  onDeath: (cb) => {
    ipcRenderer.on("bot:death", (_e, data) => cb(data));
    return () => ipcRenderer.removeAllListeners("bot:death");
  },
});
