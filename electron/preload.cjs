const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('autoVrm', {
  pickArchive: () => ipcRenderer.invoke('autovrm:pick-archive'),
  pickFolder: () => ipcRenderer.invoke('autovrm:pick-folder'),
  analyzePath: (inputPath) => ipcRenderer.invoke('autovrm:analyze-path', inputPath),
  exportReport: (analysisId) => ipcRenderer.invoke('autovrm:export-report', analysisId),
  prepareWorkspace: (analysisId, options) => ipcRenderer.invoke('autovrm:prepare-workspace', analysisId, options),
  detectUnity: () => ipcRenderer.invoke('autovrm:detect-unity'),
  pickUnity: () => ipcRenderer.invoke('autovrm:pick-unity'),
  runUnity: (payload) => ipcRenderer.invoke('autovrm:run-unity', payload),
  openPath: (targetPath) => ipcRenderer.invoke('autovrm:open-path', targetPath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onWorkerLog: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('autovrm:worker-log', listener);
    return () => ipcRenderer.removeListener('autovrm:worker-log', listener);
  },
});
