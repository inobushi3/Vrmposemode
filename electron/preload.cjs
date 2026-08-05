const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  rtmw3d: {
    status: () => ipcRenderer.invoke('rtmw3d:status'),
    prepare: () => ipcRenderer.invoke('rtmw3d:prepare'),
    infer: (request) => ipcRenderer.invoke('rtmw3d:infer', request),
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('rtmw3d:progress', listener);
      return () => ipcRenderer.removeListener('rtmw3d:progress', listener);
    },
  },
  textMotion: {
    getSettings: () => ipcRenderer.invoke('text-motion:get-settings'),
    saveSettings: (request) => ipcRenderer.invoke('text-motion:save-settings', request),
    testConnection: () => ipcRenderer.invoke('text-motion:test'),
    generate: (request) => ipcRenderer.invoke('text-motion:generate', request),
    cancel: () => ipcRenderer.send('text-motion:cancel'),
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('text-motion:progress', listener);
      return () => ipcRenderer.removeListener('text-motion:progress', listener);
    },
  },
});
