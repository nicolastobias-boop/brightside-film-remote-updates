const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("brightside", {
  getState: () => ipcRenderer.invoke("state:get"),
  saveSettings: settings => ipcRenderer.invoke("settings:save", settings),
  runAssistant: (text, engine) => ipcRenderer.invoke("assistant:run", text, engine),
  importProjectFiles: () => ipcRenderer.invoke("project:import"),
  removeProjectFile: id => ipcRenderer.invoke("project:remove", id),
  transcribe: (buffer, mime) => ipcRenderer.invoke("voice:transcribe", buffer, mime),
  createImage: request => ipcRenderer.invoke("image:create", request),
  navigate: url => ipcRenderer.invoke("higgs:navigate", url),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  openProjectFolder: () => ipcRenderer.invoke("project:open-folder"),
  decideApproval: decision => ipcRenderer.send("approval:decision", decision),
  onApproval: callback => ipcRenderer.on("approval:request", (_event, value) => callback(value)),
  onUrl: callback => ipcRenderer.on("higgs:url", (_event, value) => callback(value)),
  onApprovalBudget: callback => ipcRenderer.on("approval:budget", (_event, value) => callback(value)),
  onUpdateStatus: callback => ipcRenderer.on("update:status", (_event, value) => callback(value))
});
