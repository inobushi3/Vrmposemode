const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('frameLens', {
  listSources: () => ipcRenderer.invoke('capture:list-sources'),
  recognize: (payload) => ipcRenderer.invoke('ocr:recognize', payload),
  translate: (payload) => ipcRenderer.invoke('translate:text', payload),
  onOcrProgress: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('ocr:progress', handler);
    return () => ipcRenderer.removeListener('ocr:progress', handler);
  },
});
