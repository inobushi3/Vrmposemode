import path from 'node:path';
import fs from 'node:fs/promises';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { AIRuntime } from './runtime.mjs';
import { DubPipeline } from './pipeline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow;
let runtime;
let activePipeline;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 850,
    minWidth: 800,
    minHeight: 650,
    backgroundColor: '#0c0f14',
    title: 'Dublagem de Video AI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  } else {
    mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  runtime = new AIRuntime((data) => send('runtime:progress', data));
  createWindow();

  ipcMain.handle('runtime:status', async () => runtime.status());
  ipcMain.handle('runtime:setup', async () => runtime.setup());

  ipcMain.handle('file:select-video', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolha um vídeo',
      properties: ['openFile'],
      filters: [{ name: 'Vídeos', extensions: ['mp4','mkv','mov','webm','avi','m4v'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const p = result.filePaths[0];
    const stat = await fs.stat(p);
    return {
      path: p,
      name: path.basename(p),
      prettySize: stat.size > 1024 ** 3 ? `${(stat.size / 1024 ** 3).toFixed(2)} GB` : `${(stat.size / 1024 ** 2).toFixed(0)} MB`,
      defaultOutputDir: path.join(path.dirname(p), 'Dublado PT-BR')
    };
  });

  ipcMain.handle('file:select-output', async (_event, current) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolha a pasta de saída',
      defaultPath: current || app.getPath('videos'),
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('file:open', async (_event, target) => {
    if (!target) return;
    await shell.showItemInFolder(target);
  });

  ipcMain.handle('job:start', async (_event, options) => {
    if (activePipeline) throw new Error('Já existe um vídeo em processamento.');
    activePipeline = new DubPipeline(runtime, (data) => send('job:progress', data));
    try {
      return await activePipeline.start(options);
    } finally {
      activePipeline = null;
    }
  });

  ipcMain.handle('job:cancel', async () => {
    activePipeline?.cancel();
    return true;
  });
});

app.on('window-all-closed', async () => {
  await runtime?.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
