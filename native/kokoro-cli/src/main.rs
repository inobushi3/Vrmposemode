use anyhow::{bail, Context, Result};
use kokoro_en::{KokoroTts, Voice};
use serde::Deserialize;
use std::{env, fs, io::Write, path::{Path, PathBuf}};

#[derive(Debug, Deserialize)]
struct Job {
    id: usize,
    text: String,
    speed: Option<f32>,
}

fn arg(name: &str) -> Result<String> {
    let args: Vec<String> = env::args().collect();
    args.windows(2)
        .find(|x| x[0] == name)
        .map(|x| x[1].clone())
        .with_context(|| format!("argumento obrigatório ausente: {name}"))
}

fn write_wav(path: &Path, audio: &[f32]) -> Result<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 24_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)?;
    for &sample in audio {
        let v = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        writer.write_sample(v)?;
    }
    writer.finalize()?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let model = arg("--model")?;
    let voices = arg("--voices")?;
    let voice_name = arg("--voice")?;
    let jobs_path = arg("--jobs")?;
    let out_dir = PathBuf::from(arg("--out-dir")?);

    fs::create_dir_all(&out_dir)?;
    let jobs: Vec<Job> = serde_json::from_str(&fs::read_to_string(&jobs_path)?)?;
    if jobs.is_empty() { bail!("lista de TTS vazia"); }

    // Em Windows, o app define KOKORO_ORT_PROVIDER=directml para usar a Radeon.
    let tts = KokoroTts::new(&model, &voices).await?;
    let total = jobs.len();

    for (index, job) in jobs.iter().enumerate() {
        let output = out_dir.join(format!("{:06}.wav", job.id));
        if output.exists() && output.metadata().map(|m| m.len() > 1000).unwrap_or(false) {
            println!("PROGRESS {} {}", index + 1, total);
            std::io::stdout().flush()?;
            continue;
        }
        let voice = Voice::new(&voice_name).with_speed(job.speed.unwrap_or(1.0));
        let (audio, _elapsed) = tts.synth(&job.text, voice).await?;
        write_wav(&output, &audio)?;
        println!("PROGRESS {} {}", index + 1, total);
        std::io::stdout().flush()?;
    }
    Ok(())
}
