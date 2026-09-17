const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('videoDub', {
  runtimeStatus: () => ipcRenderer.invoke('runtime:status'),
  setupRuntime: () => ipcRenderer.invoke('runtime:setup'),
  selectVideo: () => ipcRenderer.invoke('file:select-video'),
  selectOutput: (current) => ipcRenderer.invoke('file:select-output', current),
  startJob: (options) => ipcRenderer.invoke('job:start', options),
  cancelJob: () => ipcRenderer.invoke('job:cancel'),
  openPath: (target) => ipcRenderer.invoke('file:open', target),
  onRuntimeProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('runtime:progress', listener);
    return () => ipcRenderer.removeListener('runtime:progress', listener);
  },
  onJobProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('job:progress', listener);
    return () => ipcRenderer.removeListener('job:progress', listener);
  }
});
