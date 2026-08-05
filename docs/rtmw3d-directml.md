# RTMW3D-x com DirectML

O modo **RTMW3D HQ** executa estimativa de pose 3D local no processo principal do Electron.

## Pipeline

1. O MediaPipe Pose Landmarker Lite localiza uma pessoa no quadro.
2. A região corporal é expandida, ajustada para a proporção 288×384 e convertida para o tensor de entrada.
3. O RTMW3D-x ONNX calcula 133 pontos de corpo inteiro em 3D.
4. O resultado é convertido para a estrutura corporal usada pelo retargeter VRM.
5. Imagens criam uma pose; GIFs e vídeos criam keyframes editáveis.

## GPU AMD no Windows

No Windows, o aplicativo tenta criar a sessão ONNX Runtime com o Execution Provider DirectML no adaptador 0. Esse caminho permite usar GPUs DirectX 12, incluindo GPUs AMD compatíveis. Caso a inicialização DirectML falhe, o aplicativo informa o backend utilizado e recua para CPU em vez de interromper o editor.

As opções de sessão usadas com DirectML seguem as restrições do provider:

- execução sequencial;
- memory pattern desabilitado;
- arena de memória da CPU desabilitada;
- otimizações de grafo ativadas.

## Modelo local

O arquivo ONNX não é incluído no Git por causa do tamanho. Na primeira execução de **Analisar com RTMW3D**, o aplicativo baixa o peso oficial usado pela integração e salva em:

```text
<userData>/models/rtmw3d/rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626.onnx
```

Depois disso, a inferência pode reutilizar o arquivo local. Downloads incompletos ficam em um arquivo temporário e são descartados.

## Privacidade

As imagens e quadros de vídeo são processados localmente. Somente o peso do modelo é baixado na primeira preparação do motor.

## Limites e validação

- O modo foi projetado para uma pessoa por referência.
- A qualidade do recorte inicial depende de a pessoa estar visível para o detector leve.
- A profundidade inferida por vídeo monocular continua sendo uma estimativa.
- O build automático valida instalação, TypeScript e empacotamento Vite, mas a execução DirectML precisa ser confirmada em um computador Windows com GPU AMD compatível.
- O painel mostra `DirectML` quando a GPU foi realmente selecionada; se mostrar `CPU`, o fallback foi usado.

## Fontes e atribuição

- RTMW3D/RTMPose e MMPose: OpenMMLab.
- Implementação de referência do pré e pós-processamento: rtmlib.
- Runtime local: Microsoft ONNX Runtime e DirectML.
