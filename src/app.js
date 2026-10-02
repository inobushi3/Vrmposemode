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
  suggestRegion: $('#suggestRegion'),
  markRegion: $('#markRegion'),
  resetRegion: $('#resetRegion'),
  previewCanvas: $('#previewCanvas'),
  previewPlaceholder: $('#previewPlaceholder'),
  selectionHint: $('#selectionHint'),
  captureStatus: $('#captureStatus'),
  captureStatusText: $('#captureStatusText'),
  scanNow: $('#scanNow'),
  copyText: $('#copyText'),
  ocrMeta: $('#ocrMeta'),
  translatedOutput: $('#translatedOutput'),
  originalOutput: $('#originalOutput'),
  historyList: $('#historyList'),
  clearHistory: $('#clearHistory'),
  captureVideo: $('#captureVideo'),
  captureCanvas: $('#captureCanvas'),
  ocrCanvas: $('#ocrCanvas'),
  changeCanvas: $('#changeCanvas'),
};

const previewCtx = els.previewCanvas.getContext('2d');
const captureCtx = els.captureCanvas.getContext('2d', { willReadFrequently: true });
const ocrCtx = els.ocrCanvas.getContext('2d', { willReadFrequently: true });
const changeCtx = els.changeCanvas.getContext('2d', { willReadFrequently: true });

const PROBE_INTERVAL_MS = 180;
const STABLE_FOR_MS = 520;
const FRAME_CHANGE_THRESHOLD = 0.028;
const NEW_DIALOGUE_THRESHOLD = 0.072;

let sources = [];
let stream = null;
let frameRequest = null;
let ocrBusy = false;
let selectionMode = false;
let dragStart = null;
let dragCurrent = null;
let history = [];
let lastOriginal = '';
let lastTranslated = '';
let region = { x: 0.12, y: 0.68, w: 0.76, h: 0.22 };

let lastProbeAt = 0;
let previousProbe = null;
let lastProcessedProbe = null;
let lastVisualChangeAt = 0;
let detectorStartedAt = 0;
let initialScanPending = true;

function setStatus(text, state = 'idle') {
  els.captureStatusText.textContent = text;
  els.captureStatus.dataset.state = state;
}

function setOcrMeta(text) {
  els.ocrMeta.textContent = text;
}

function normalizedRegionFromPixels(rect) {
  const w = els.previewCanvas.width || 1;
  const h = els.previewCanvas.height || 1;
  return { x: rect.x / w, y: rect.y / h, w: rect.w / w, h: rect.h / h };
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

function resetDetector() {
  previousProbe = null;
  lastProcessedProbe = null;
  lastVisualChangeAt = performance.now();
  detectorStartedAt = performance.now();
  initialScanPending = true;
  lastProbeAt = 0;
}

function resetRegion() {
  region = { x: 0.12, y: 0.68, w: 0.76, h: 0.22 };
  resetDetector();
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
    setStatus(stream ? 'Observando diálogo' : 'Jogo ainda não conectado', stream ? 'live' : 'idle');
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
  resetDetector();
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
    resetDetector();
    setStatus('Observando diálogo', 'live');
    setOcrMeta('Aguardando a caixa de diálogo estabilizar.');
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
  const r = { x: region.x * width, y: region.y * height, w: region.w * width, h: region.h * height };

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

function drawDragOverlay(ctx, width) {
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

function buildVisualProbe() {
  const r = pixelRegion();
  const width = 80;
  const height = Math.max(16, Math.min(32, Math.round(width * (r.h / r.w))));
  els.changeCanvas.width = width;
  els.changeCanvas.height = height;
  changeCtx.clearRect(0, 0, width, height);
  changeCtx.drawImage(els.captureCanvas, r.x, r.y, r.w, r.h, 0, 0, width, height);
  const data = changeCtx.getImageData(0, 0, width, height).data;
  const probe = new Uint8Array(width * height);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const lum = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
    probe[p] = Math.round(lum / 32) * 32;
  }
  return probe;
}

function probeDifference(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) >= 32) changed += 1;
  }
  return changed / a.length;
}

function maybeDetectDialogue(now) {
  if (!els.autoOcr.checked || selectionMode || ocrBusy || now - lastProbeAt < PROBE_INTERVAL_MS) return;
  lastProbeAt = now;

  const probe = buildVisualProbe();
  if (!previousProbe) {
    previousProbe = probe;
    lastVisualChangeAt = now;
    return;
  }

  const frameDiff = probeDifference(probe, previousProbe);
  if (frameDiff >= FRAME_CHANGE_THRESHOLD) lastVisualChangeAt = now;
  previousProbe = probe;

  const stable = now - lastVisualChangeAt >= STABLE_FOR_MS;
  if (!stable) {
    setStatus('Nova fala aparecendo…', 'busy');
    return;
  }

  setStatus('Observando diálogo', 'live');

  if (initialScanPending && now - detectorStartedAt >= 850) {
    initialScanPending = false;
    runOcr(probe, false);
    return;
  }

  if (!lastProcessedProbe) return;
  const dialogueDiff = probeDifference(probe, lastProcessedProbe);
  if (dialogueDiff >= NEW_DIALOGUE_THRESHOLD) runOcr(probe, false);
}

function drawFrame(now = performance.now()) {
  if (!stream) return;
  const { width, height } = els.captureCanvas;
  captureCtx.drawImage(els.captureVideo, 0, 0, width, height);
  previewCtx.clearRect(0, 0, width, height);
  previewCtx.drawImage(els.captureCanvas, 0, 0, width, height);
  drawRegionOverlay(previewCtx, width, height);
  drawDragOverlay(previewCtx, width);
  maybeDetectDialogue(now);
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
  setOcrMeta('Marque somente a área onde as letras aparecem.');
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
    resetDetector();
    setOcrMeta('Área atualizada. Aguardando a fala estabilizar.');
  }

  leaveSelectionMode();
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

  for (let y = Math.floor(sample.height * 0.52); y < sample.height - 2; y += 1) {
    let edges = 0;
    for (let x = 8; x < sample.width - 8; x += 2) {
      const i = (y * sample.width + x) * 4;
      const j = (y * sample.width + x + 2) * 4;
      const lumA = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      const lumB = data[j] * 0.2126 + data[j + 1] * 0.7152 + data[j + 2] * 0.0722;
      edges += Math.min(60, Math.abs(lumA - lumB));
    }
    rowScores[y] = edges * (0.85 + y / sample.height * 0.3);
  }

  let bestY = Math.floor(sample.height * 0.76);
  let bestScore = -1;
  for (let y = Math.floor(sample.height * 0.55); y < sample.height - 5; y += 1) {
    let score = 0;
    for (let k = -3; k <= 3; k += 1) score += rowScores[Math.max(0, Math.min(sample.height - 1, y + k))];
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }

  const center = bestY / sample.height;
  const height = 0.20;
  const y = Math.max(0.52, Math.min(0.97 - height, center - height * 0.5));
  region = clampRegion({ x: 0.10, y, w: 0.80, h: height });
  resetDetector();
  setOcrMeta('Área sugerida. Refine com “Marcar área” se houver personagem ou HUD dentro dela.');
}

function buildOcrImage() {
  const r = pixelRegion();
  const targetHeight = 330;
  const scale = Math.max(1.8, Math.min(4.0, targetHeight / Math.max(1, r.h)));
  const outW = Math.max(1, Math.min(2600, Math.round(r.w * scale)));
  const outH = Math.max(1, Math.round(r.h * (outW / r.w)));
  els.ocrCanvas.width = outW;
  els.ocrCanvas.height = outH;

  const mode = els.preprocessSelect.value;
  ocrCtx.save();
  ocrCtx.clearRect(0, 0, outW, outH);
  ocrCtx.imageSmoothingEnabled = true;
  ocrCtx.imageSmoothingQuality = 'high';

  if (mode === 'dialogue') ocrCtx.filter = 'grayscale(1) contrast(1.75) brightness(1.06)';
  else if (mode === 'contrast') ocrCtx.filter = 'grayscale(1) contrast(1.45)';
  else ocrCtx.filter = 'none';

  ocrCtx.drawImage(els.captureCanvas, r.x, r.y, r.w, r.h, 0, 0, outW, outH);
  ocrCtx.restore();

  if (mode === 'mono') {
    const image = ocrCtx.getImageData(0, 0, outW, outH);
    const pixels = image.data;
    const histogram = new Uint32Array(256);
    for (let i = 0; i < pixels.length; i += 4) {
      const lum = Math.round(pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722);
      histogram[lum] += 1;
    }

    const total = pixels.length / 4;
    let cumulative = 0;
    let median = 128;
    for (let i = 0; i < 256; i += 1) {
      cumulative += histogram[i];
      if (cumulative >= total / 2) {
        median = i;
        break;
      }
    }

    const threshold = Math.max(70, Math.min(205, median));
    for (let i = 0; i < pixels.length; i += 4) {
      const lum = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
      const value = lum > threshold ? 255 : 0;
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
    }
    ocrCtx.putImageData(image, 0, 0);
  }

  return {
    image: els.ocrCanvas.toDataURL('image/png'),
    aspectRatio: outW / Math.max(1, outH),
  };
}

function cleanText(value, language) {
  let lines = String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim().replace(/\s{2,}/g, ' '))
    .filter(Boolean);

  if (language === 'eng') {
    lines = lines
      .map((line) => line.replace(/[^A-Za-z0-9.,!?;:'"()\-… ]/g, ' ').replace(/\s{2,}/g, ' ').trim())
      .filter((line) => {
        const compact = line.replace(/\s/g, '');
        const letters = (compact.match(/[A-Za-z]/g) || []).length;
        return letters >= 2 && letters / Math.max(1, compact.length) >= 0.38;
      });
  }

  return lines.join(' ').replace(/\s+([,.!?;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

function textKey(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function showOutput(element, text, emptyText) {
  element.replaceChildren();
  if (!text) {
    const empty = document.createElement('span');
    empty.className = 'output-empty';
    empty.textContent = emptyText;
    element.append(empty);
    return;
  }
  element.textContent = text;
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
    const translated = document.createElement('p');
    translated.className = 'history-translation';
    translated.textContent = item.translated || item.original;
    const original = document.createElement('small');
    original.textContent = item.original;
    card.append(time, translated, original);
    els.historyList.append(card);
  }
}

async function runOcr(probe = null, force = true) {
  if (!stream || ocrBusy || selectionMode) return;
  ocrBusy = true;
  els.scanNow.disabled = true;
  setStatus('Lendo nova fala…', 'busy');
  setOcrMeta('Isolando as letras da área marcada…');

  try {
    const prepared = buildOcrImage();
    const result = await window.frameLens.recognize({
      image: prepared.image,
      aspectRatio: prepared.aspectRatio,
      language: els.languageSelect.value,
    });

    const language = els.languageSelect.value;
    const original = cleanText(result.text || '', language);
    const confidence = Math.max(0, Math.min(100, Math.round(result.confidence || 0)));
    const enoughText = language === 'jpn'
      ? original.length >= 2
      : (original.match(/[\p{L}\p{N}]/gu) || []).length >= 3;

    lastProcessedProbe = probe || buildVisualProbe();

    if (!original || !enoughText || confidence < 30) {
      if (force) {
        showOutput(els.originalOutput, '', 'Nenhum texto confiável encontrado nessa área.');
        showOutput(els.translatedOutput, '', 'Nada para traduzir.');
      }
      setOcrMeta(`Leitura descartada por baixa confiança (${confidence}%). Ajuste a área mais perto das letras.`);
      return;
    }

    showOutput(els.originalOutput, original, '');
    setOcrMeta(`Original reconhecido · confiança aproximada ${confidence}% · traduzindo…`);

    const isSameDialogue = textKey(original) === textKey(lastOriginal);
    if (isSameDialogue && lastTranslated) {
      showOutput(els.translatedOutput, lastTranslated, '');
      setOcrMeta(`Fala já reconhecida · confiança aproximada ${confidence}%`);
      return;
    }

    let translated = original;
    try {
      const translation = await window.frameLens.translate({ text: original, language });
      translated = cleanText(translation?.text || '', 'por') || original;
    } catch (translationError) {
      console.error('Translation failed:', translationError);
      translated = '';
    }

    if (translated) {
      showOutput(els.translatedOutput, translated, '');
      setOcrMeta(`Nova fala · confiança aproximada ${confidence}%`);
    } else {
      showOutput(els.translatedOutput, '', 'Não foi possível traduzir esta fala. O original foi preservado abaixo.');
      setOcrMeta(`OCR concluído (${confidence}%), mas a tradução falhou.`);
    }

    lastOriginal = original;
    lastTranslated = translated;
    history.unshift({
      original,
      translated,
      time: new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()),
    });
    history = history.slice(0, 12);
    renderHistory();
  } catch (error) {
    console.error(error);
    setOcrMeta('Falha no OCR. Na primeira leitura, o idioma pode precisar ser baixado.');
    setStatus('Falha na leitura', 'error');
  } finally {
    ocrBusy = false;
    els.scanNow.disabled = false;
    if (stream) setStatus('Observando diálogo', 'live');
  }
}

els.refreshSources.addEventListener('click', refreshSources);
els.sourceSelect.addEventListener('change', updateSelectedSource);
els.startCapture.addEventListener('click', startCapture);
els.scanNow.addEventListener('click', () => runOcr(null, true));
els.suggestRegion.addEventListener('click', suggestDialogueRegion);
els.markRegion.addEventListener('click', () => selectionMode ? leaveSelectionMode() : enterSelectionMode());
els.resetRegion.addEventListener('click', () => {
  resetRegion();
  setOcrMeta('Área padrão restaurada. Aguardando a fala estabilizar.');
});
els.languageSelect.addEventListener('change', () => {
  lastOriginal = '';
  lastTranslated = '';
  resetDetector();
  setOcrMeta('Idioma alterado. A próxima fala será lida novamente.');
});
els.preprocessSelect.addEventListener('change', () => {
  resetDetector();
  setOcrMeta('Tratamento alterado. A próxima fala será lida novamente.');
});
els.autoOcr.addEventListener('change', () => {
  resetDetector();
  setOcrMeta(els.autoOcr.checked ? 'Detecção de nova fala ativada.' : 'Detecção automática pausada. Use “Ler agora”.');
});
els.previewCanvas.addEventListener('pointerdown', onPointerDown);
els.previewCanvas.addEventListener('pointermove', onPointerMove);
els.previewCanvas.addEventListener('pointerup', onPointerUp);
els.previewCanvas.addEventListener('pointercancel', leaveSelectionMode);
els.copyText.addEventListener('click', async () => {
  const text = lastTranslated || lastOriginal;
  if (!text) return;
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
    setOcrMeta(`Lendo letras… ${Math.round((message.progress || 0) * 100)}%`);
  }
});

window.addEventListener('beforeunload', stopCapture);
renderHistory();
refreshSources();
