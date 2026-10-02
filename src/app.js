const $ = (selector) => document.querySelector(selector);

const els = {
  sourceSelect: $('#sourceSelect'),
  refreshSources: $('#refreshSources'),
  sourceThumbnail: $('#sourceThumbnail'),
  sourceEmpty: $('#sourceEmpty'),
  sourceKind: $('#sourceKind'),
  sourceName: $('#sourceName'),
  startCapture: $('#startCapture'),
  languageSelect: $('#languageSelect'),
  preprocessSelect: $('#preprocessSelect'),
  autoOcr: $('#autoOcr'),
  intervalRange: $('#intervalRange'),
  intervalValue: $('#intervalValue'),
  suggestRegion: $('#suggestRegion'),
  markRegion: $('#markRegion'),
  resetRegion: $('#resetRegion'),
  previewStage: $('#previewStage'),
  previewCanvas: $('#previewCanvas'),
  previewPlaceholder: $('#previewPlaceholder'),
  selectionHint: $('#selectionHint'),
  captureStatus: $('#captureStatus'),
  captureStatusText: $('#captureStatusText'),
  scanNow: $('#scanNow'),
  copyText: $('#copyText'),
  ocrMeta: $('#ocrMeta'),
  ocrOutput: $('#ocrOutput'),
  historyList: $('#historyList'),
  clearHistory: $('#clearHistory'),
  captureVideo: $('#captureVideo'),
  captureCanvas: $('#captureCanvas'),
  ocrCanvas: $('#ocrCanvas'),
};

const previewCtx = els.previewCanvas.getContext('2d');
const captureCtx = els.captureCanvas.getContext('2d', { willReadFrequently: true });
const ocrCtx = els.ocrCanvas.getContext('2d', { willReadFrequently: true });

let sources = [];
let stream = null;
let frameRequest = null;
let ocrBusy = false;
let nextOcrAt = 0;
let selectionMode = false;
let dragStart = null;
let dragCurrent = null;
let lastText = '';
let history = [];
let region = { x: 0.06, y: 0.62, w: 0.88, h: 0.30 };

function setStatus(text, state = 'idle') {
  els.captureStatusText.textContent = text;
  els.captureStatus.dataset.state = state;
}

function setOcrMeta(text) {
  els.ocrMeta.textContent = text;
}

function formatInterval(value) {
  return `${(Number(value) / 1000).toFixed(1).replace('.', ',')} s`;
}

function normalizedRegionFromPixels(rect) {
  const w = els.previewCanvas.width || 1;
  const h = els.previewCanvas.height || 1;
  return {
    x: rect.x / w,
    y: rect.y / h,
    w: rect.w / w,
    h: rect.h / h,
  };
}

function pixelRegion() {
  const w = els.captureCanvas.width || els.previewCanvas.width || 1;
  const h = els.captureCanvas.height || els.previewCanvas.height || 1;
  return {
    x: Math.max(0, Math.round(region.x * w)),
    y: Math.max(0, Math.round(region.y * h)),
    w: Math.max(1, Math.round(region.w * w)),
    h: Math.max(1, Math.round(region.h * h)),
  };
}

function clampRegion(input) {
  const x = Math.min(0.98, Math.max(0, input.x));
  const y = Math.min(0.98, Math.max(0, input.y));
  return {
    x,
    y,
    w: Math.min(1 - x, Math.max(0.02, input.w)),
    h: Math.min(1 - y, Math.max(0.02, input.h)),
  };
}

function resetRegion() {
  region = { x: 0.06, y: 0.62, w: 0.88, h: 0.30 };
}

async function refreshSources() {
  setStatus('Procurando janelas…', 'busy');
  const previous = els.sourceSelect.value;

  try {
    sources = (await window.frameLens.listSources()).filter((source) => source.name !== 'FrameLens');
    els.sourceSelect.replaceChildren();

    const windows = sources.filter((source) => source.kind === 'window');
    const screens = sources.filter((source) => source.kind === 'screen');

    if (!sources.length) {
      const option = document.createElement('option');
      option.textContent = 'Nenhuma janela encontrada';
      option.value = '';
      els.sourceSelect.append(option);
      els.startCapture.disabled = true;
      updateSelectedSource();
      setStatus('Nenhuma janela encontrada', 'error');
      return;
    }

    const appendGroup = (label, items) => {
      if (!items.length) return;
      const group = document.createElement('optgroup');
      group.label = label;
      for (const source of items) {
        const option = document.createElement('option');
        option.value = source.id;
        option.textContent = source.name;
        group.append(option);
      }
      els.sourceSelect.append(group);
    };

    appendGroup('Janelas abertas', windows);
    appendGroup('Monitores', screens);

    if (previous && sources.some((source) => source.id === previous)) {
      els.sourceSelect.value = previous;
    }

    els.startCapture.disabled = false;
    updateSelectedSource();
    setStatus(stream ? 'Capturando jogo' : 'Jogo ainda não conectado', stream ? 'live' : 'idle');
  } catch (error) {
    console.error(error);
    setStatus('Falha ao listar janelas', 'error');
  }
}

function updateSelectedSource() {
  const source = sources.find((item) => item.id === els.sourceSelect.value);
  els.sourceName.textContent = source?.name || '—';
  els.sourceKind.textContent = source?.kind === 'screen' ? 'Monitor' : 'Janela';

  if (source?.thumbnail) {
    els.sourceThumbnail.src = source.thumbnail;
    els.sourceThumbnail.classList.add('visible');
    els.sourceEmpty.classList.add('hidden');
  } else {
    els.sourceThumbnail.removeAttribute('src');
    els.sourceThumbnail.classList.remove('visible');
    els.sourceEmpty.classList.remove('hidden');
  }
}

function stopCapture() {
  if (frameRequest) cancelAnimationFrame(frameRequest);
  frameRequest = null;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  stream = null;
  els.captureVideo.srcObject = null;
}

async function startCapture() {
  const sourceId = els.sourceSelect.value;
  if (!sourceId) return;

  stopCapture();
  setStatus('Conectando ao jogo…', 'busy');
  els.startCapture.disabled = true;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 640,
          maxWidth: 3840,
          minHeight: 360,
          maxHeight: 2160,
          maxFrameRate: 30,
        },
      },
    });

    els.captureVideo.srcObject = stream;
    await els.captureVideo.play();

    if (!els.captureVideo.videoWidth) {
      await new Promise((resolve) => els.captureVideo.addEventListener('loadedmetadata', resolve, { once: true }));
    }

    const width = els.captureVideo.videoWidth || 1280;
    const height = els.captureVideo.videoHeight || 720;
    els.captureCanvas.width = width;
    els.captureCanvas.height = height;
    els.previewCanvas.width = width;
    els.previewCanvas.height = height;

    els.previewPlaceholder.classList.add('hidden');
    els.startCapture.textContent = 'Reconectar';
    setStatus('Capturando jogo', 'live');
    nextOcrAt = performance.now() + 500;
    drawFrame();
  } catch (error) {
    console.error(error);
    stopCapture();
    setStatus('Não foi possível capturar', 'error');
    setOcrMeta('A captura da janela falhou. Tente outra janela ou monitor.');
  } finally {
    els.startCapture.disabled = false;
  }
}

function drawRegionOverlay(ctx, width, height) {
  const r = {
    x: region.x * width,
    y: region.y * height,
    w: region.w * width,
    h: region.h * height,
  };

  ctx.save();
  ctx.fillStyle = 'rgba(7, 10, 9, 0.50)';
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.fill('evenodd');

  ctx.strokeStyle = '#e7a25a';
  ctx.lineWidth = Math.max(2, width / 700);
  ctx.setLineDash([Math.max(8, width / 90), Math.max(5, width / 140)]);
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.setLineDash([]);

  const corner = Math.max(14, width / 55);
  ctx.strokeStyle = '#ffd09e';
  ctx.lineWidth = Math.max(3, width / 520);
  const corners = [
    [r.x, r.y, 1, 1],
    [r.x + r.w, r.y, -1, 1],
    [r.x, r.y + r.h, 1, -1],
    [r.x + r.w, r.y + r.h, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * corner, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * corner);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDragOverlay(ctx, width, height) {
  if (!dragStart || !dragCurrent) return;
  const x = Math.min(dragStart.x, dragCurrent.x);
  const y = Math.min(dragStart.y, dragCurrent.y);
  const w = Math.abs(dragCurrent.x - dragStart.x);
  const h = Math.abs(dragCurrent.y - dragStart.y);
  ctx.save();
  ctx.fillStyle = 'rgba(231, 162, 90, .10)';
  ctx.strokeStyle = '#ffd09e';
  ctx.lineWidth = Math.max(2, width / 600);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawFrame(now = performance.now()) {
  if (!stream) return;

  const { width, height } = els.captureCanvas;
  captureCtx.drawImage(els.captureVideo, 0, 0, width, height);
  previewCtx.clearRect(0, 0, width, height);
  previewCtx.drawImage(els.captureCanvas, 0, 0, width, height);
  drawRegionOverlay(previewCtx, width, height);
  drawDragOverlay(previewCtx, width, height);

  if (els.autoOcr.checked && !ocrBusy && now >= nextOcrAt && !selectionMode) {
    nextOcrAt = now + Number(els.intervalRange.value);
    runOcr();
  }

  frameRequest = requestAnimationFrame(drawFrame);
}

function canvasPoint(event) {
  const rect = els.previewCanvas.getBoundingClientRect();
  return {
    x: Math.min(els.previewCanvas.width, Math.max(0, (event.clientX - rect.left) * (els.previewCanvas.width / rect.width))),
    y: Math.min(els.previewCanvas.height, Math.max(0, (event.clientY - rect.top) * (els.previewCanvas.height / rect.height))),
  };
}

function enterSelectionMode() {
  if (!stream) return;
  selectionMode = true;
  dragStart = null;
  dragCurrent = null;
  els.selectionHint.classList.add('visible');
  els.markRegion.textContent = 'Cancelar marcação';
  els.previewCanvas.style.cursor = 'crosshair';
}

function leaveSelectionMode() {
  selectionMode = false;
  dragStart = null;
  dragCurrent = null;
  els.selectionHint.classList.remove('visible');
  els.markRegion.textContent = 'Marcar área';
  els.previewCanvas.style.cursor = 'default';
}

function onPointerDown(event) {
  if (!selectionMode || !stream) return;
  dragStart = canvasPoint(event);
  dragCurrent = dragStart;
  els.previewCanvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!selectionMode || !dragStart) return;
  dragCurrent = canvasPoint(event);
}

function onPointerUp(event) {
  if (!selectionMode || !dragStart) return;
  dragCurrent = canvasPoint(event);

  const x = Math.min(dragStart.x, dragCurrent.x);
  const y = Math.min(dragStart.y, dragCurrent.y);
  const w = Math.abs(dragCurrent.x - dragStart.x);
  const h = Math.abs(dragCurrent.y - dragStart.y);

  if (w > 30 && h > 20) {
    region = clampRegion(normalizedRegionFromPixels({ x, y, w, h }));
  }

  leaveSelectionMode();
  nextOcrAt = performance.now() + 250;
}

function suggestDialogueRegion() {
  if (!stream || !els.captureCanvas.width) return;

  const sample = document.createElement('canvas');
  sample.width = 180;
  sample.height = 100;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(els.captureCanvas, 0, 0, sample.width, sample.height);
  const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
  const rowScores = new Array(sample.height).fill(0);

  for (let y = Math.floor(sample.height * 0.34); y < sample.height - 1; y += 1) {
    let edges = 0;
    let dark = 0;
    for (let x = 2; x < sample.width - 2; x += 2) {
      const i = (y * sample.width + x) * 4;
      const j = (y * sample.width + x + 2) * 4;
      const lumA = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      const lumB = data[j] * 0.2126 + data[j + 1] * 0.7152 + data[j + 2] * 0.0722;
      edges += Math.min(70, Math.abs(lumA - lumB));
      if (lumA < 95) dark += 1;
    }
    const lowerBias = 0.75 + (y / sample.height) * 0.35;
    rowScores[y] = edges * lowerBias + dark * 2.1;
  }

  let bestY = Math.floor(sample.height * 0.72);
  let bestScore = -1;
  for (let y = Math.floor(sample.height * 0.40); y < sample.height - 4; y += 1) {
    let score = 0;
    for (let k = -3; k <= 3; k += 1) score += rowScores[Math.max(0, Math.min(sample.height - 1, y + k))];
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }

  const center = bestY / sample.height;
  const height = center > 0.73 ? 0.25 : 0.30;
  const y = Math.max(0.38, Math.min(0.96 - height, center - height * 0.45));
  region = clampRegion({ x: 0.055, y, w: 0.89, h: height });
  nextOcrAt = performance.now() + 250;
}

function buildOcrImage() {
  const r = pixelRegion();
  const scale = Math.min(2.2, 2200 / Math.max(r.w, r.h));
  const outW = Math.max(1, Math.round(r.w * scale));
  const outH = Math.max(1, Math.round(r.h * scale));
  els.ocrCanvas.width = outW;
  els.ocrCanvas.height = outH;

  ocrCtx.save();
  ocrCtx.clearRect(0, 0, outW, outH);
  ocrCtx.imageSmoothingEnabled = true;
  ocrCtx.imageSmoothingQuality = 'high';
  ocrCtx.filter = els.preprocessSelect.value === 'contrast'
    ? 'grayscale(1) contrast(1.35)'
    : 'none';
  ocrCtx.drawImage(els.captureCanvas, r.x, r.y, r.w, r.h, 0, 0, outW, outH);
  ocrCtx.restore();

  if (els.preprocessSelect.value === 'mono') {
    const image = ocrCtx.getImageData(0, 0, outW, outH);
    const pixels = image.data;
    let average = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      average += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
    }
    average /= pixels.length / 4;
    const threshold = Math.max(80, Math.min(190, average));
    for (let i = 0; i < pixels.length; i += 4) {
      const lum = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
      const value = lum > threshold ? 255 : 0;
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
    }
    ocrCtx.putImageData(image, 0, 0);
  }

  return els.ocrCanvas.toDataURL('image/png');
}

function cleanText(value) {
  return value
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim().replace(/\s{2,}/g, ' '))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function renderHistory() {
  els.historyList.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'Sem leituras ainda.';
    els.historyList.append(empty);
    return;
  }

  for (const item of history) {
    const card = document.createElement('div');
    card.className = 'history-item';
    const time = document.createElement('time');
    time.textContent = item.time;
    const text = document.createElement('p');
    text.textContent = item.text;
    card.append(time, text);
    els.historyList.append(card);
  }
}

function showText(text) {
  els.ocrOutput.replaceChildren();
  if (!text) {
    const empty = document.createElement('span');
    empty.className = 'output-empty';
    empty.textContent = 'Nenhum texto legível encontrado nessa área.';
    els.ocrOutput.append(empty);
    return;
  }
  els.ocrOutput.textContent = text;
}

async function runOcr() {
  if (!stream || ocrBusy || selectionMode) return;
  ocrBusy = true;
  els.scanNow.disabled = true;
  setStatus('Lendo diálogo…', 'busy');
  setOcrMeta('Preparando a área selecionada…');

  try {
    const image = buildOcrImage();
    const result = await window.frameLens.recognize({
      image,
      language: els.languageSelect.value,
    });

    const text = cleanText(result.text || '');
    const confidence = Math.max(0, Math.min(100, Math.round(result.confidence || 0)));
    showText(text);
    setOcrMeta(text ? `Confiança aproximada: ${confidence}%` : 'Nenhum texto legível encontrado.');

    if (text && text !== lastText) {
      lastText = text;
      history.unshift({
        text,
        time: new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()),
      });
      history = history.slice(0, 12);
      renderHistory();
    }
  } catch (error) {
    console.error(error);
    setOcrMeta('Falha no OCR. Na primeira leitura, o idioma pode precisar ser baixado.');
    setStatus('Falha na leitura', 'error');
  } finally {
    ocrBusy = false;
    els.scanNow.disabled = false;
    if (stream) setStatus('Capturando jogo', 'live');
  }
}

els.refreshSources.addEventListener('click', refreshSources);
els.sourceSelect.addEventListener('change', updateSelectedSource);
els.startCapture.addEventListener('click', startCapture);
els.scanNow.addEventListener('click', runOcr);
els.suggestRegion.addEventListener('click', suggestDialogueRegion);
els.markRegion.addEventListener('click', () => selectionMode ? leaveSelectionMode() : enterSelectionMode());
els.resetRegion.addEventListener('click', () => {
  resetRegion();
  nextOcrAt = performance.now() + 250;
});
els.intervalRange.addEventListener('input', () => {
  els.intervalValue.textContent = formatInterval(els.intervalRange.value);
  nextOcrAt = performance.now() + Number(els.intervalRange.value);
});
els.previewCanvas.addEventListener('pointerdown', onPointerDown);
els.previewCanvas.addEventListener('pointermove', onPointerMove);
els.previewCanvas.addEventListener('pointerup', onPointerUp);
els.previewCanvas.addEventListener('pointercancel', leaveSelectionMode);
els.copyText.addEventListener('click', async () => {
  const text = cleanText(els.ocrOutput.textContent || '');
  if (!text || els.ocrOutput.querySelector('.output-empty')) return;
  await navigator.clipboard.writeText(text);
  const original = els.copyText.textContent;
  els.copyText.textContent = 'Copiado';
  setTimeout(() => { els.copyText.textContent = original; }, 900);
});
els.clearHistory.addEventListener('click', () => {
  history = [];
  renderHistory();
});

window.frameLens.onOcrProgress((message) => {
  if (!ocrBusy) return;
  if (message.status === 'loading language traineddata') {
    setOcrMeta(`Carregando idioma… ${Math.round((message.progress || 0) * 100)}%`);
  } else if (message.status === 'recognizing text') {
    setOcrMeta(`Lendo texto… ${Math.round((message.progress || 0) * 100)}%`);
  }
});

window.addEventListener('beforeunload', stopCapture);
els.intervalValue.textContent = formatInterval(els.intervalRange.value);
renderHistory();
refreshSources();
