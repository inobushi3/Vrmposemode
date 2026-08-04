const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');

let mainWindow;

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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
