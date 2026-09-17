# Dublagem de Vídeo AI

Aplicativo desktop para Windows que recebe um vídeo de até **60 minutos** e entrega uma versão **dublada em português do Brasil**, com processamento local.

## Fluxo

1. **Whisper Large v3 Turbo** transcreve o áudio e preserva timestamps.
2. **Qwen 3.5 9B** traduz os trechos para PT-BR sem resumir o conteúdo.
3. **Kokoro 82M** gera a voz brasileira escolhida.
4. **FFmpeg** ajusta cada fala ao tempo original e remonta o vídeo.
5. O app salva `.srt` original e traduzido, além do MP4 final.

O app mantém cache por vídeo. Se o processo for interrompido, as etapas concluídas são reaproveitadas.

## Foco em AMD Radeon RX 9060 XT 16 GB

A configuração padrão foi feita para Radeon RDNA4 no Windows:

- Whisper: `whisper.cpp` via **ROCm**, com fallback **Vulkan**.
- Tradução: `llama.cpp` via **ROCm**, com fallback **Vulkan**.
- TTS: Kokoro/ONNX Runtime via **DirectML**.
- Apenas um modelo pesado fica carregado por vez, reduzindo pressão sobre os 16 GB de VRAM.

A camada de runtime de Whisper/Qwen usa [Lemonade](https://github.com/lemonade-sdk/lemonade). O TTS usa [kokoro-en](https://github.com/pguso/kokoro), que oferece backend DirectML no Windows.

## Modelos

- `Whisper-Large-v3-Turbo`
- `Qwen3.5-9B-GGUF`
- `Kokoro-82M-v1.0-ONNX`
  - `pf_dora` — feminina PT-BR
  - `pm_alex` — masculina PT-BR
  - `pm_santa` — masculina PT-BR

Na primeira execução, clique em **Preparar IA**. O app baixa o runtime, os backends GPU e os modelos automaticamente.

## Desenvolvimento

Requisitos para desenvolver/compilar:

- Windows 11 x64
- Node.js 22+
- Rust stable / Cargo
- Driver AMD atualizado

```powershell
npm install
npm run build:tts
npm run dev
```

### Gerar instalador/portable

```powershell
npm run dist
```

Os arquivos ficam em `release/`.

## Saída

Para `aula01.mp4`:

```text
aula01_PTBR_DUBLADO.mp4
aula01_PTBR.srt
aula01_ORIGINAL.srt
```

O cache fica na pasta de saída com nome `.videodub-cache-*`.

## Limitações atuais

- Máximo de 60 minutos por vídeo.
- A versão atual faz uma voz PT-BR única por vídeo; não faz diarização/múltiplos dubladores.
- O TTS não clona a voz original nesta primeira versão.
- Para música/efeitos misturados à fala, há opção de manter o áudio original bem baixo sob a dublagem.
- O primeiro setup exige internet para baixar runtimes e modelos. Depois, a inferência é local.

## Privacidade

Os vídeos não são enviados a serviços de dublagem. A inferência de transcrição, tradução e voz roda localmente depois do setup.

## Licença

MIT. Consulte também as licenças dos modelos e runtimes baixados separadamente antes de redistribuí-los comercialmente.
