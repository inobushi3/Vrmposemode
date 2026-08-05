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
  pap: {
    status: () => ipcRenderer.invoke('pap:status'),
    prepare: () => ipcRenderer.invoke('pap:prepare'),
    convert: (request) => ipcRenderer.invoke('pap:convert', request),
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('pap:progress', listener);
      return () => ipcRenderer.removeListener('pap:progress', listener);
    },
  },
});
