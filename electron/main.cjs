const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { Rtmw3dService } = require('./rtmw3d.cjs');
const { PapConverterService } = require('./papConverter.cjs');

let mainWindow;
let rtmw3dService;
let papConverterService;

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

ipcMain.handle('pap:status', async () => {
  if (!papConverterService) throw new Error('O conversor PAP ainda não foi inicializado.');
  return papConverterService.status();
});
ipcMain.handle('pap:prepare', async () => {
  if (!papConverterService) throw new Error('O conversor PAP ainda não foi inicializado.');
  return papConverterService.prepare();
});
ipcMain.handle('pap:convert', async (_event, request) => {
  if (!papConverterService) throw new Error('O conversor PAP ainda não foi inicializado.');
  return papConverterService.convert(request);
});

app.whenReady().then(() => {
  rtmw3dService = new Rtmw3dService({
    app,
    onProgress: (payload) => mainWindow?.webContents.send('rtmw3d:progress', payload),
  });
  papConverterService = new PapConverterService({
    app,
    onProgress: (payload) => mainWindow?.webContents.send('pap:progress', payload),
  });
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  void rtmw3dService?.dispose();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
