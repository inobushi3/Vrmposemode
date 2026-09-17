import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const MAX_DURATION = 60 * 60;
const CHUNK_SECONDS = 10 * 60;
const TTS_RATE = 24000;

function fixAsar(p) {
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

function parseJsonArray(text) {
  const raw = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const a = raw.indexOf('[');
  const b = raw.lastIndexOf(']');
  if (a < 0 || b <= a) throw new Error('A tradução não retornou JSON válido.');
  return JSON.parse(raw.slice(a, b + 1));
}

function srtTime(sec) {
  const msTotal = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(msTotal / 3600000);
  const m = Math.floor((msTotal % 3600000) / 60000);
  const s = Math.floor((msTotal % 60000) / 1000);
  const ms = msTotal % 1000;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

async function writeSrt(segments, file, translated = false) {
  const body = segments.map((x, i) => `${i + 1}\n${srtTime(x.start)} --> ${srtTime(x.end)}\n${(translated ? x.translated : x.text).trim()}\n`).join('\n');
  await fsp.writeFile(file, `\ufeff${body}`, 'utf8');
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function readJson(p, fallback = null) {
  try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return fallback; }
}

async function writeJson(p, value) {
  await fsp.writeFile(p, JSON.stringify(value, null, 2), 'utf8');
}

function mergeSegments(input) {
  const out = [];
  for (const raw of input) {
    const text = String(raw.text || '').trim();
    if (!text) continue;
    const seg = { start: Number(raw.start), end: Number(raw.end), text };
    const prev = out[out.length - 1];
    const canMerge = prev && (seg.start - prev.end) <= 0.7 && (seg.end - prev.start) <= 14 && (prev.text.length + text.length) <= 280;
    if (canMerge) {
      prev.end = seg.end;
      prev.text = `${prev.text} ${text}`.trim();
    } else {
      out.push(seg);
    }
  }
  return out.map((x, id) => ({ id, ...x, translated: '' }));
}

function wavPcmData(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAV inválido.');
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') return buffer.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  throw new Error('Chunk data não encontrado no WAV.');
}

function wavHeader(dataBytes, sampleRate = TTS_RATE) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(dataBytes, 40);
  return h;
}

function atempoChain(factor) {
  let f = Math.max(0.25, Math.min(8, factor));
  const arr = [];
  while (f > 2) { arr.push(2); f /= 2; }
  while (f < 0.5) { arr.push(0.5); f /= 0.5; }
  arr.push(f);
  return arr.map(v => `atempo=${v.toFixed(6)}`).join(',');
}

export class DubPipeline {
  constructor(runtime, onProgress = () => {}) {
    this.runtime = runtime;
    this.onProgress = onProgress;
    this.cancelled = false;
    this.currentProcess = null;
    this.ffmpeg = fixAsar(ffmpegStatic);
    this.ffprobe = fixAsar(ffprobeStatic.path);
  }

  emit(progress, stage, message, extra = {}) {
    this.onProgress({ running: progress < 100, progress, stage, message, ...extra });
  }

  checkCancel() {
    if (this.cancelled) throw new Error('Processamento cancelado.');
  }

  cancel() {
    this.cancelled = true;
    if (this.currentProcess && !this.currentProcess.killed) this.currentProcess.kill();
  }

  run(exe, args, opts = {}) {
    this.checkCancel();
    return new Promise((resolve, reject) => {
      const child = spawn(exe, args.map(String), { windowsHide: true, ...opts });
      this.currentProcess = child;
      let out = '';
      child.stdout?.on('data', d => { out += d.toString(); opts.onStdout?.(d.toString()); });
      child.stderr?.on('data', d => { out += d.toString(); opts.onStderr?.(d.toString()); });
      child.on('error', reject);
      child.on('close', code => {
        if (this.currentProcess === child) this.currentProcess = null;
        if (this.cancelled) return reject(new Error('Processamento cancelado.'));
        if (code === 0) resolve(out);
        else reject(new Error(`Comando falhou (${code}).\n${out.split('\n').slice(-20).join('\n')}`));
      });
    });
  }

  async probe(video) {
    const raw = await this.run(this.ffprobe, ['-v','error','-show_entries','format=duration,size','-of','json',video]);
    const obj = JSON.parse(raw);
    return { duration: Number(obj.format?.duration || 0), size: Number(obj.format?.size || 0) };
  }

  async cacheDir(videoPath, outputDir) {
    const stat = await fsp.stat(videoPath);
    const key = crypto.createHash('sha1').update(`${videoPath}|${stat.size}|${stat.mtimeMs}`).digest('hex').slice(0, 14);
    const dir = path.join(outputDir, `.videodub-cache-${key}`);
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  }

  async extractChunks(videoPath, work, duration) {
    const dir = path.join(work, 'chunks');
    await fsp.mkdir(dir, { recursive: true });
    const expected = Math.ceil(duration / CHUNK_SECONDS);
    const files = [];
    for (let i = 0; i < expected; i++) {
      const file = path.join(dir, `chunk-${String(i).padStart(3,'0')}.wav`);
      files.push(file);
      if (await exists(file)) continue;
      this.emit(3 + (i / expected) * 4, 'Preparando áudio', `Extraindo bloco ${i + 1}/${expected}...`);
      await this.run(this.ffmpeg, ['-y','-ss',i * CHUNK_SECONDS,'-t',Math.min(CHUNK_SECONDS, duration - i * CHUNK_SECONDS),'-i',videoPath,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',file]);
    }
    return files;
  }

  async transcribe(chunks, cacheFile, sourceLanguage) {
    const cached = await readJson(cacheFile);
    if (cached?.segments?.length) return cached;

    this.emit(7, 'Transcrevendo', 'Carregando Whisper Large v3 Turbo na Radeon...');
    await this.runtime.loadModel('Whisper-Large-v3-Turbo');
    const all = [];
    let detected = sourceLanguage;
    try {
      for (let i = 0; i < chunks.length; i++) {
        this.checkCancel();
        this.emit(8 + (i / chunks.length) * 22, 'Transcrevendo', `Whisper: bloco ${i + 1}/${chunks.length}`);
        const result = await this.runtime.transcribeWav(chunks[i], sourceLanguage);
        detected = result.language || detected || 'auto';
        for (const s of result.segments || []) {
          all.push({ start: Number(s.start) + i * CHUNK_SECONDS, end: Number(s.end) + i * CHUNK_SECONDS, text: s.text });
        }
      }
    } finally {
      await this.runtime.unloadModel('Whisper-Large-v3-Turbo');
    }
    const segments = mergeSegments(all);
    const payload = { language: detected, segments };
    await writeJson(cacheFile, payload);
    return payload;
  }

  async translate(segments, cacheFile, sourceLanguage) {
    let cache = await readJson(cacheFile, { segments: null });
    if (cache?.segments?.length === segments.length && cache.segments.every(x => x.translated)) return cache.segments;
    const working = cache?.segments?.length === segments.length ? cache.segments : structuredClone(segments);

    const primaryModel = 'Qwen3.5-9B-GGUF';
    const fallbackModel = 'Qwen3.5-4B-GGUF';
    let activeModel = primaryModel;

    const activateFallback = async (reason) => {
      if (activeModel === fallbackModel) return;
      console.warn('Qwen 9B falhou; ativando fallback 4B:', reason?.message || reason);
      try { await this.runtime.unloadModel(activeModel); } catch {}
      this.emit(31.5, 'Traduzindo', 'Qwen 9B falhou. Preparando Qwen 3.5 4B compatível...');
      await this.runtime.ensureModel(fallbackModel, 31.5, 'Baixando Qwen 3.5 4B de fallback...');
      await this.runtime.loadModel(fallbackModel, { ensure: false });
      activeModel = fallbackModel;
    };

    this.emit(31, 'Traduzindo', 'Carregando Qwen 3.5 9B na Radeon...');
    try {
      await this.runtime.loadModel(primaryModel);
    } catch (e) {
      await activateFallback(e);
    }

    const batchSize = 8;
    try {
      for (let pos = 0; pos < working.length; pos += batchSize) {
        this.checkCancel();
        const batch = working.slice(pos, pos + batchSize).filter(x => !x.translated);
        if (!batch.length) continue;
        const pct = 32 + (pos / working.length) * 23;
        this.emit(pct, 'Traduzindo', `${activeModel.includes('4B') ? 'Qwen 4B' : 'Qwen 9B'}: ${Math.min(pos + batchSize, working.length)}/${working.length} trechos`);
        const request = batch.map(x => ({ id: x.id, text: x.text }));
        let parsed;

        try {
          parsed = parseJsonArray(await this.runtime.translateBatch(request, sourceLanguage, activeModel));
        } catch (e) {
          // Erro HTTP 5xx no Qwen 9B: troca automaticamente para o 4B e repete o lote.
          if (activeModel === primaryModel && (e?.status >= 500 || String(e?.message || '').includes('Lemonade'))) {
            await activateFallback(e);
            parsed = parseJsonArray(await this.runtime.translateBatch(request, sourceLanguage, activeModel));
          } else {
            // Se foi só resposta JSON ruim, reduz o lote para um trecho por vez.
            parsed = [];
            for (const item of request) {
              const one = parseJsonArray(await this.runtime.translateBatch([item], sourceLanguage, activeModel));
              parsed.push(...one);
            }
          }
        }

        const map = new Map(parsed.map(x => [Number(x.id), String(x.text || '').trim()]));
        for (const seg of batch) {
          const translated = map.get(seg.id);
          if (!translated) throw new Error(`A tradução não retornou o trecho ${seg.id}.`);
          seg.translated = translated;
        }
        await writeJson(cacheFile, { segments: working });
      }
    } finally {
      await this.runtime.unloadModel(activeModel);
    }
    return working;
  }

  async synthesize(segments, work, voice) {
    const rawDir = path.join(work, 'tts-raw');
    const fitDir = path.join(work, 'tts-fit');
    await fsp.mkdir(rawDir, { recursive: true });
    await fsp.mkdir(fitDir, { recursive: true });
    const jobsPath = path.join(work, 'tts-jobs.json');
    await writeJson(jobsPath, segments.map(s => ({ id: s.id, text: s.translated, speed: 1.0 })));

    const { cli, model, voices } = this.runtime.getKokoroPaths();
    if (!(await exists(cli))) throw new Error('Kokoro CLI não foi encontrado. Em desenvolvimento, execute: npm run build:tts');

    this.emit(56, 'Gerando voz', 'Kokoro PT-BR usando DirectML na Radeon...');
    let directMlActive = false;
    await this.run(cli, ['--model', model, '--voices', voices, '--voice', voice, '--jobs', jobsPath, '--out-dir', rawDir], {
      env: { ...process.env, KOKORO_ORT_PROVIDER: 'directml' },
      onStdout: (txt) => {
        const m = txt.match(/PROGRESS\s+(\d+)\s+(\d+)/);
        if (m) this.emit(56 + (Number(m[1]) / Number(m[2])) * 18, 'Gerando voz', `Kokoro: ${m[1]}/${m[2]} trechos`);
      },
      onStderr: (txt) => {
        if (txt.toLowerCase().includes('using directml execution provider')) directMlActive = true;
      }
    });
    if (!directMlActive) {
      throw new Error('O Kokoro não conseguiu ativar DirectML. Atualize o driver AMD; esta versão não aceita fallback de TTS para CPU.');
    }

    for (let i = 0; i < segments.length; i++) {
      this.checkCancel();
      const s = segments[i];
      const src = path.join(rawDir, `${String(s.id).padStart(6,'0')}.wav`);
      const dst = path.join(fitDir, `${String(s.id).padStart(6,'0')}.wav`);
      if (await exists(dst)) continue;
      const rawDuration = (await this.probe(src)).duration;
      const target = Math.max(0.12, s.end - s.start);
      const factor = Math.max(1, rawDuration / target);
      const filter = `${atempoChain(factor)},apad,atrim=0:${target.toFixed(6)}`;
      await this.run(this.ffmpeg, ['-y','-i',src,'-af',filter,'-ar',String(TTS_RATE),'-ac','1','-c:a','pcm_s16le',dst]);
      if (i % 8 === 0) this.emit(74 + (i / segments.length) * 10, 'Sincronizando voz', `${i + 1}/${segments.length} trechos`);
    }
    return fitDir;
  }

  async assembleTimeline(segments, fitDir, duration, outWav) {
    if (await exists(outWav)) return;
    this.emit(85, 'Montando áudio', 'Posicionando as falas na timeline...');
    const chunks = [];
    let frames = 0;
    for (const seg of segments) {
      const targetStart = Math.max(0, Math.round(seg.start * TTS_RATE));
      if (targetStart > frames) {
        chunks.push(Buffer.alloc((targetStart - frames) * 2));
        frames = targetStart;
      }
      const file = path.join(fitDir, `${String(seg.id).padStart(6,'0')}.wav`);
      const pcm = wavPcmData(await fsp.readFile(file));
      chunks.push(pcm);
      frames += pcm.length / 2;
    }
    const totalFrames = Math.round(duration * TTS_RATE);
    if (totalFrames > frames) chunks.push(Buffer.alloc((totalFrames - frames) * 2));
    const pcm = Buffer.concat(chunks);
    await fsp.writeFile(outWav, Buffer.concat([wavHeader(pcm.length), pcm]));
  }

  async mux(videoPath, dubWav, outputPath, keepOriginal) {
    this.emit(94, 'Finalizando vídeo', 'Colocando a dublagem no vídeo...');
    if (keepOriginal) {
      await this.run(this.ffmpeg, ['-y','-i',videoPath,'-i',dubWav,'-filter_complex','[0:a]volume=0.08[orig];[orig][1:a]amix=inputs=2:duration=longest:normalize=0[a]','-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart',outputPath]);
    } else {
      await this.run(this.ffmpeg, ['-y','-i',videoPath,'-i',dubWav,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart',outputPath]);
    }
  }

  async start({ videoPath, outputDir, voice = 'pm_alex', sourceLanguage = 'auto', keepOriginal = false }) {
    this.cancelled = false;
    await fsp.mkdir(outputDir, { recursive: true });
    const info = await this.probe(videoPath);
    if (!info.duration || info.duration <= 0) throw new Error('Não consegui ler a duração do vídeo.');
    if (info.duration > MAX_DURATION + 1) throw new Error(`O vídeo tem ${(info.duration / 60).toFixed(1)} min. Esta versão aceita até 60 minutos.`);

    const ext = path.extname(videoPath);
    const stem = path.basename(videoPath, ext).replace(/[<>:"/\\|?*]/g, '_');
    const work = await this.cacheDir(videoPath, outputDir);
    const transCache = path.join(work, 'transcription.json');
    const translationCache = path.join(work, 'translation.json');
    const dubWav = path.join(work, 'dub.wav');
    const originalSrt = path.join(outputDir, `${stem}_ORIGINAL.srt`);
    const translatedSrt = path.join(outputDir, `${stem}_PTBR.srt`);
    const outputPath = path.join(outputDir, `${stem}_PTBR_DUBLADO.mp4`);

    this.emit(1, 'Preparando', 'Lendo vídeo e preparando cache...');
    const chunks = await this.extractChunks(videoPath, work, info.duration);
    const transcription = await this.transcribe(chunks, transCache, sourceLanguage);
    await writeSrt(transcription.segments, originalSrt, false);
    const translated = await this.translate(transcription.segments, translationCache, transcription.language || sourceLanguage);
    await writeSrt(translated, translatedSrt, true);
    const fitDir = await this.synthesize(translated, work, voice);
    await this.assembleTimeline(translated, fitDir, info.duration, dubWav);
    await this.mux(videoPath, dubWav, outputPath, keepOriginal);
    this.emit(100, 'Concluído', 'Vídeo dublado pronto.', { running: false, output: outputPath });
    return { outputPath, translatedSrt, originalSrt, cacheDir: work };
  }
}
