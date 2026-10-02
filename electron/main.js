const path = require('node:path');
const { app, BrowserWindow, desktopCapturer, ipcMain } = require('electron');
const { createWorker } = require('tesseract.js');

let mainWindow = null;
let ocrWorker = null;
let ocrLanguage = null;
let workerPromise = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: '#0d1211',
    autoHideMenuBar: true,
    title: 'FrameLens',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
}

async function ensureWorker(language) {
  if (ocrWorker && ocrLanguage === language) return ocrWorker;
  if (workerPromise && ocrLanguage === language) return workerPromise;

  if (ocrWorker) {
    await ocrWorker.terminate();
    ocrWorker = null;
  }

  ocrLanguage = language;
  workerPromise = createWorker(language, 1, {
    cachePath: app.getPath('userData'),
    logger(message) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ocr:progress', message);
      }
    },
  }).then(async (worker) => {
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });
    ocrWorker = worker;
    workerPromise = null;
    return worker;
  }).catch((error) => {
    workerPromise = null;
    throw error;
  });

  return workerPromise;
}

ipcMain.handle('capture:list-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id,
    kind: source.id.startsWith('window:') ? 'window' : 'screen',
    thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : null,
    icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
  }));
});

ipcMain.handle('ocr:recognize', async (_event, payload) => {
  const language = payload?.language || 'eng';
  const image = payload?.image;
  if (!image) throw new Error('Imagem não recebida pelo OCR.');

  const worker = await ensureWorker(language);
  const { data } = await worker.recognize(image);
  return {
    text: data.text || '',
    confidence: Number.isFinite(data.confidence) ? data.confidence : 0,
  };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (ocrWorker) ocrWorker.terminate().catch(() => {});
});
