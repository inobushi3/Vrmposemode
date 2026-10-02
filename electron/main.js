const path = require('node:path');
const { app, BrowserWindow, desktopCapturer, ipcMain } = require('electron');
const { createWorker } = require('tesseract.js');

let mainWindow = null;
let ocrWorker = null;
let ocrLanguage = null;
let workerPromise = null;
const translationCache = new Map();

const translateLanguage = {
  eng: 'en',
  por: 'pt',
  jpn: 'ja',
  spa: 'es',
  fra: 'fr',
  deu: 'de',
};

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
  }).then((worker) => {
    ocrWorker = worker;
    workerPromise = null;
    return worker;
  }).catch((error) => {
    workerPromise = null;
    throw error;
  });

  return workerPromise;
}

function englishTextScore(data) {
  const text = String(data?.text || '').trim();
  if (!text) return -100;
  const chars = text.replace(/\s/g, '');
  const letters = (chars.match(/[A-Za-z]/g) || []).length;
  const suspicious = (chars.match(/[^A-Za-z0-9.,!?;:'"()\-…]/g) || []).length;
  const letterRatio = chars.length ? letters / chars.length : 0;
  const suspiciousRatio = chars.length ? suspicious / chars.length : 0;
  return Number(data?.confidence || 0) + letterRatio * 18 - suspiciousRatio * 40;
}

async function recognizePass(worker, image, language, psm) {
  const parameters = {
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  };

  if (language === 'eng') {
    parameters.tessedit_char_whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?;:'\"()-… ";
  }

  await worker.setParameters(parameters);
  const { data } = await worker.recognize(image);
  return data;
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
  const aspectRatio = Number(payload?.aspectRatio || 4);
  if (!image) throw new Error('Imagem não recebida pelo OCR.');

  const worker = await ensureWorker(language);
  const primaryPsm = aspectRatio >= 7 ? 7 : 6;
  const primary = await recognizePass(worker, image, language, primaryPsm);

  let best = primary;
  if (Number(primary.confidence || 0) < 62) {
    const fallback = await recognizePass(worker, image, language, 11);
    if (language === 'eng') {
      if (englishTextScore(fallback) > englishTextScore(primary)) best = fallback;
    } else if (Number(fallback.confidence || 0) > Number(primary.confidence || 0)) {
      best = fallback;
    }
  }

  return {
    text: best.text || '',
    confidence: Number.isFinite(best.confidence) ? best.confidence : 0,
  };
});

ipcMain.handle('translate:text', async (_event, payload) => {
  const text = String(payload?.text || '').trim();
  const sourceLanguage = payload?.language || 'eng';
  if (!text) return { text: '' };
  if (sourceLanguage === 'por') return { text };

  const source = translateLanguage[sourceLanguage] || 'auto';
  const key = `${source}|pt|${text}`;
  if (translationCache.has(key)) return { text: translationCache.get(key) };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', source);
    url.searchParams.set('tl', 'pt');
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', text);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FrameLens/0.1' },
    });
    if (!response.ok) throw new Error(`Tradução retornou HTTP ${response.status}`);

    const body = await response.json();
    const translated = Array.isArray(body?.[0])
      ? body[0].map((part) => Array.isArray(part) ? part[0] : '').join('').trim()
      : '';

    if (!translated) throw new Error('Resposta de tradução vazia.');
    translationCache.set(key, translated);
    if (translationCache.size > 200) translationCache.delete(translationCache.keys().next().value);
    return { text: translated };
  } finally {
    clearTimeout(timeout);
  }
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
