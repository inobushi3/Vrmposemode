const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { Rtmw3dService } = require('./rtmw3d.cjs');
const { TextMotionService } = require('./textMotion.cjs');

let mainWindow;
let rtmw3dService;
let textMotionService;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: '#0d0b16',
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL('http://127.0.0.1:5173');

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

ipcMain.handle('dialog:open-model', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir modelo 3D',
    properties: ['openFile'],
    filters: [
      { name: 'Modelos VRM e glTF', extensions: ['vrm', 'glb', 'gltf'] },
      { name: 'Todos os arquivos', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('rtmw3d:status', async () => rtmw3dService?.status());
ipcMain.handle('rtmw3d:prepare', async () => {
  if (!rtmw3dService) throw new Error('O motor RTMW3D ainda não foi inicializado.');
  return rtmw3dService.prepare();
});
ipcMain.handle('rtmw3d:infer', async (_event, request) => {
  if (!rtmw3dService) throw new Error('O motor RTMW3D ainda não foi inicializado.');
  return rtmw3dService.infer(request);
});

ipcMain.handle('text-motion:get-settings', async () => {
  if (!textMotionService) throw new Error('O gerador por texto ainda não foi inicializado.');
  return textMotionService.getSettings();
});
ipcMain.handle('text-motion:save-settings', async (_event, request) => {
  if (!textMotionService) throw new Error('O gerador por texto ainda não foi inicializado.');
  return textMotionService.saveSettings(request);
});
ipcMain.handle('text-motion:test', async () => {
  if (!textMotionService) throw new Error('O gerador por texto ainda não foi inicializado.');
  return textMotionService.testConnection();
});
ipcMain.handle('text-motion:generate', async (_event, request) => {
  if (!textMotionService) throw new Error('O gerador por texto ainda não foi inicializado.');
  return textMotionService.generate(request);
});
ipcMain.on('text-motion:cancel', () => textMotionService?.cancel());

app.whenReady().then(() => {
  rtmw3dService = new Rtmw3dService({
    app,
    onProgress: (payload) => mainWindow?.webContents.send('rtmw3d:progress', payload),
  });
  textMotionService = new TextMotionService({
    app,
    onProgress: (payload) => mainWindow?.webContents.send('text-motion:progress', payload),
  });
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  textMotionService?.cancel();
  void rtmw3dService?.dispose();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
