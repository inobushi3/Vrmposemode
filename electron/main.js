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

async function fetchJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function parseGoogleTranslation(body) {
  if (Array.isArray(body?.[0])) {
    const text = body[0]
      .map((part) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : ''))
      .join('')
      .trim();
    if (text) return text;
  }

  if (Array.isArray(body?.sentences)) {
    const text = body.sentences
      .map((part) => (typeof part?.trans === 'string' ? part.trans : ''))
      .join('')
      .trim();
    if (text) return text;
  }

  return '';
}

async function translateWithGoogle(text, source, host) {
  const url = new URL(`${host}/translate_a/single`);
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', source);
  url.searchParams.set('tl', 'pt');
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);

  const body = await fetchJson(url, 6500);
  const translated = parseGoogleTranslation(body);
  if (!translated) throw new Error('resposta vazia');
  return translated;
}

async function translateWithMyMemory(text, source) {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', `${source}|pt-BR`);

  const body = await fetchJson(url, 7500);
  const translated = String(body?.responseData?.translatedText || '').trim();
  const upper = translated.toUpperCase();
  if (!translated || upper.includes('NO QUERY SPECIFIED')) {
    throw new Error('resposta vazia');
  }
  return translated;
}

async function translateToPortuguese(text, source) {
  const attempts = [
    {
      provider: 'Google',
      run: () => translateWithGoogle(text, source, 'https://translate.googleapis.com'),
    },
    {
      provider: 'Google fallback',
      run: () => translateWithGoogle(text, source, 'https://translate.google.com'),
    },
    {
      provider: 'MyMemory',
      run: () => translateWithMyMemory(text, source),
    },
  ];

  const failures = [];
  for (const attempt of attempts) {
    try {
      const translated = await attempt.run();
      if (translated) return { text: translated, provider: attempt.provider };
    } catch (error) {
      const reason = error?.name === 'AbortError' ? 'timeout' : (error?.message || 'erro desconhecido');
      failures.push(`${attempt.provider}: ${reason}`);
      console.warn(`[translation] ${attempt.provider} failed:`, error);
    }
  }

  throw new Error(`Nenhum tradutor respondeu (${failures.join(' | ')})`);
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
  if (!text) return { text: '', provider: 'none' };
  if (sourceLanguage === 'por') return { text, provider: 'local' };

  const source = translateLanguage[sourceLanguage] || 'auto';
  const key = `${source}|pt-BR|${text}`;
  if (translationCache.has(key)) return translationCache.get(key);

  const result = await translateToPortuguese(text, source);
  translationCache.set(key, result);
  if (translationCache.size > 200) translationCache.delete(translationCache.keys().next().value);
  return result;
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
