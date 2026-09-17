import React, { useEffect, useMemo, useState } from "react";

const voices = [
  { id: "pf_dora", label: "Dora — feminina PT-BR" },
  { id: "pm_alex", label: "Alex — masculina PT-BR" },
  { id: "pm_santa", label: "Santa — masculina PT-BR" }
];

function pct(v) {
  const n = Math.max(0, Math.min(100, Number(v || 0)));
  return `${Math.round(n)}%`;
}

export default function App() {
  const [runtime, setRuntime] = useState({
    ready: false,
    runtimeInstalled: false,
    modelsReady: false,
    backend: null,
    ttsReady: false
  });
  const [setup, setSetup] = useState({ running: false, message: "", progress: 0 });
  const [video, setVideo] = useState(null);
  const [outputDir, setOutputDir] = useState("");
  const [voice, setVoice] = useState("pm_alex");
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [job, setJob] = useState({
    running: false,
    stage: "Pronto",
    message: "",
    progress: 0,
    output: "",
    error: ""
  });

  const canStart = useMemo(
    () => runtime.ready && video?.path && !job.running && !setup.running,
    [runtime.ready, video, job.running, setup.running]
  );

  async function refreshRuntime() {
    const s = await window.videoDub.runtimeStatus();
    setRuntime(s);
  }

  useEffect(() => {
    refreshRuntime();

    const offRuntime = window.videoDub.onRuntimeProgress((data) => {
      setSetup((old) => ({
        ...old,
        running: true,
        message: data.message || old.message,
        progress: data.progress ?? old.progress
      }));
    });

    const offJob = window.videoDub.onJobProgress((data) => {
      setJob((old) => ({
        ...old,
        running: data.running ?? old.running,
        stage: data.stage ?? old.stage,
        message: data.message ?? old.message,
        progress: data.progress ?? old.progress,
        output: data.output ?? old.output,
        error: data.error ?? old.error
      }));
    });

    return () => {
      offRuntime?.();
      offJob?.();
    };
  }, []);

  async function prepareAI() {
    setSetup({ running: true, message: "Preparando runtime local...", progress: 1 });
    try {
      const s = await window.videoDub.setupRuntime();
      setRuntime(s);
      setSetup({ running: false, message: "IA pronta.", progress: 100 });
    } catch (e) {
      setSetup({
        running: false,
        message: e?.message || String(e),
        progress: 0
      });
    }
  }

  async function chooseVideo() {
    const file = await window.videoDub.selectVideo();
    if (!file) return;
    setVideo(file);
    if (!outputDir) setOutputDir(file.defaultOutputDir || "");
    setJob((old) => ({ ...old, output: "", error: "", progress: 0, stage: "Pronto" }));
  }

  async function chooseOutput() {
    const dir = await window.videoDub.selectOutput(outputDir);
    if (dir) setOutputDir(dir);
  }

  async function startJob() {
    if (!canStart) return;
    setJob({
      running: true,
      stage: "Iniciando",
      message: "Preparando o vídeo...",
      progress: 0,
      output: "",
      error: ""
    });
    try {
      const result = await window.videoDub.startJob({
        videoPath: video.path,
        outputDir,
        voice,
        sourceLanguage,
        keepOriginal
      });
      setJob((old) => ({
        ...old,
        running: false,
        progress: 100,
        stage: "Concluído",
        message: "Dublagem finalizada.",
        output: result.outputPath || old.output
      }));
    } catch (e) {
      setJob((old) => ({
        ...old,
        running: false,
        stage: "Erro",
        error: e?.message || String(e),
        message: e?.message || String(e)
      }));
    }
  }

  async function cancelJob() {
    await window.videoDub.cancelJob();
  }

  async function openOutput() {
    if (job.output) await window.videoDub.openPath(job.output);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">LOCAL • AMD GPU • ATÉ 1 HORA</div>
          <h1>Dublagem de Vídeo AI</h1>
          <p>
            Coloque um vídeo, clique em dublar e espere. Whisper, tradução e TTS
            rodam localmente.
          </p>
        </div>
        <div className={`statusPill ${runtime.ready ? "ok" : "warn"}`}>
          <span className="dot" />
          {runtime.ready ? `IA pronta • ${runtime.backend || "GPU"}` : "IA não preparada"}
        </div>
      </header>

      {!runtime.ready && (
        <section className="card setupCard">
          <div className="cardTitle">
            <div>
              <span className="step">1</span>
              <h2>Preparar a IA uma vez</h2>
            </div>
            <span className="muted">~9 GB de modelos + backends</span>
          </div>

          <div className="modelGrid">
            <div className="modelItem">
              <strong>Whisper Large v3 Turbo</strong>
              <span>transcrição • ROCm/Vulkan</span>
            </div>
            <div className="modelItem">
              <strong>Qwen 3.5 9B</strong>
              <span>tradução • ROCm/Vulkan</span>
            </div>
            <div className="modelItem">
              <strong>Kokoro 82M PT-BR</strong>
              <span>TTS • DirectML na Radeon</span>
            </div>
          </div>

          {setup.running && (
            <div className="progressWrap">
              <div className="progressTrack">
                <div className="progressFill" style={{ width: pct(setup.progress) }} />
              </div>
              <span>{setup.message}</span>
            </div>
          )}

          <button className="primary" onClick={prepareAI} disabled={setup.running}>
            {setup.running ? "Preparando..." : "Preparar IA"}
          </button>
        </section>
      )}

      <section className="card">
        <div className="cardTitle">
          <div>
            <span className="step">2</span>
            <h2>Escolha o vídeo</h2>
          </div>
          <span className="muted">MP4, MKV, MOV, WEBM • máximo 60 min</span>
        </div>

        <button className={`dropzone ${video ? "hasFile" : ""}`} onClick={chooseVideo}>
          <div className="videoIcon">▶</div>
          {video ? (
            <div>
              <strong>{video.name}</strong>
              <span>{video.prettySize || "Vídeo selecionado"}</span>
            </div>
          ) : (
            <div>
              <strong>Clique para escolher um vídeo</strong>
              <span>O áudio original será transcrito automaticamente</span>
            </div>
          )}
        </button>

        <div className="options">
          <label>
            <span>Voz da dublagem</span>
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              {voices.map((v) => (
                <option value={v.id} key={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Idioma original</span>
            <select value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value)}>
              <option value="auto">Detectar automaticamente</option>
              <option value="en">Inglês</option>
              <option value="es">Espanhol</option>
              <option value="fr">Francês</option>
              <option value="de">Alemão</option>
              <option value="ja">Japonês</option>
              <option value="pt">Português</option>
            </select>
          </label>

          <label className="outputField">
            <span>Pasta de saída</span>
            <div className="inline">
              <input value={outputDir} readOnly placeholder="Escolha o vídeo primeiro" />
              <button className="ghost" onClick={chooseOutput}>
                Alterar
              </button>
            </div>
          </label>

          <label className="checkRow">
            <input
              type="checkbox"
              checked={keepOriginal}
              onChange={(e) => setKeepOriginal(e.target.checked)}
            />
            <span>
              Manter o áudio original bem baixo por trás da dublagem
              <small>Útil quando o vídeo tem música/efeitos junto da voz.</small>
            </span>
          </label>
        </div>
      </section>

      <section className="card actionCard">
        {job.running || job.progress > 0 ? (
          <div className="jobBox">
            <div className="jobLine">
              <div>
                <strong>{job.stage}</strong>
                <span>{job.message}</span>
              </div>
              <b>{Math.round(job.progress)}%</b>
            </div>
            <div className="progressTrack large">
              <div className="progressFill" style={{ width: pct(job.progress) }} />
            </div>
            {job.running && (
              <button className="dangerGhost" onClick={cancelJob}>
                Cancelar
              </button>
            )}
          </div>
        ) : null}

        {job.error && <div className="errorBox">{job.error}</div>}

        {job.output ? (
          <div className="doneBox">
            <div>
              <strong>Vídeo dublado pronto</strong>
              <span>{job.output}</span>
            </div>
            <button className="secondary" onClick={openOutput}>
              Abrir arquivo
            </button>
          </div>
        ) : (
          <button className="primary giant" disabled={!canStart} onClick={startJob}>
            {runtime.ready ? "Dublar vídeo para PT-BR" : "Prepare a IA primeiro"}
          </button>
        )}
      </section>

      <footer>
        <span>Processamento local. O vídeo não é enviado para serviços de dublagem.</span>
        <span>Cache automático: se parar, o app reaproveita o que já terminou.</span>
      </footer>
    </main>
  );
}
