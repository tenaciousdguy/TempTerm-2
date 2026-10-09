const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tt', {
  setWindowSize: key => ipcRenderer.invoke('set-window-size', key),
});