# VRM Pose Mode

Editor desktop para carregar modelos **VRM**, criar poses e animações por keyframes e exportar o resultado como **VRM Animation (`.vrma`)**.

## Recursos

- Carregamento por botão ou arrastar e soltar: `.vrm`, `.glb` e `.gltf`
- Mapeamento automático dos ossos humanoides de modelos VRM
- Seleção visual dos ossos no viewport e lista organizada por grupos
- Gizmos locais de rotação e translação do quadril
- Inspector numérico de rotação e posição
- Biblioteca de poses iniciais
- Timeline com keyframes, reprodução, loop, FPS, duração, zoom e arraste de keyframes
- Interpolação suave durante a edição
- Desfazer e refazer alterações da timeline
- Criação de pose ou movimento por imagem, GIF e vídeo
- Captura corporal RTMW3D-x local com ONNX Runtime e DirectML no Windows
- Criação de movimentos por texto com provedores OpenAI-compatible
- Suporte direto a LM Studio, Ollama, OpenRouter, OpenAI e endpoints personalizados
- Validação anatômica, limites articulares e revisão opcional em duas etapas para movimentos gerados por texto
- Chaves de API mantidas no processo principal e criptografadas pelo cofre do sistema operacional quando disponível
- Câmeras prontas: frente, costas, laterais, 3/4 e rosto
- Grade, controles visuais e cor de fundo configuráveis
- Captura de preview em PNG
- Salvamento e abertura de projeto `.vrmpose.json`
- Exportação binária VRMA 1.0 usando a extensão oficial `VRMC_vrm_animation`
- Interface desktop sem instalador obrigatório

## Como executar

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm start
```

O `npm start` inicia o Vite e abre a janela do Electron automaticamente.

## Fluxo manual

1. Clique em **Abrir modelo** e selecione um `.vrm`.
2. Escolha um osso na lista ou clique nos pontos do esqueleto.
3. Rotacione com o gizmo ou use o inspector numérico.
4. Posicione a timeline e clique em **Keyframe**.
5. Repita para criar o movimento.
6. Use **Exportar VRMA**.

## Criar movimento por texto

1. Abra um modelo VRM humanoide.
2. Clique em **Criar por texto**.
3. Escolha um provedor:
   - LM Studio: `http://127.0.0.1:1234/v1`
   - Ollama: `http://127.0.0.1:11434/v1`
   - OpenRouter, OpenAI ou endpoint personalizado
4. Digite o identificador do modelo e teste a conexão.
5. Descreva ações, ritmo, estilo, duração e repetição.
6. Gere e revise o resumo, quantidade de keyframes, ossos e correções automáticas.
7. Adicione o resultado à timeline para editar manualmente antes da exportação.

O LLM nunca escreve diretamente no arquivo VRMA. Ele produz uma especificação estruturada que passa pelo compilador local do aplicativo. O compilador filtra ossos desconhecidos, limita articulações, corrige joelhos e cotovelos, encaixa os tempos no FPS e converte rotações Euler para quaternions.

Somente a descrição textual é enviada ao provedor escolhido. O arquivo VRM permanece local.

## Observações

- A exportação `.vrma` requer um modelo VRM com humanoide válido carregado.
- Arquivos GLB/GLTF podem ser visualizados e manipulados, mas não possuem necessariamente o mapeamento humanoide necessário para VRMA.
- O projeto JSON salva a animação e as configurações, mas não incorpora o arquivo do modelo por questões de tamanho e licença.
- Para `.gltf` com texturas externas, prefira converter para `.glb` ou `.vrm`, pois o seletor abre um único arquivo.
- A qualidade da criação por texto depende da capacidade do modelo escolhido de obedecer JSON e raciocinar sobre movimento corporal.
- O modo RTMW3D e o modo por texto são independentes: RTMW3D estima pose a partir de mídia; o gerador textual cria keyframes diretamente.

## Atalhos

- `Espaço`: reproduzir/pausar
- `R`: gizmo de rotação
- `G`: mover o quadril
- `K`: adicionar/atualizar keyframe
- `Ctrl+Z`: desfazer
- `Ctrl+Y` ou `Ctrl+Shift+Z`: refazer

## Estrutura

- `electron/`: janela desktop, serviços nativos, RTMW3D e provedor de texto
- `src/components/Viewport.tsx`: cena Three.js, carregamento VRM e manipulação
- `src/components/TextMotionStudio.tsx`: criação de movimentos por texto
- `src/lib/textMotion.ts`: validação e compilação do JSON em keyframes editáveis
- `src/lib/vrmaExporter.ts`: gerador GLB/VRMA 1.0
- `src/store.ts`: estado do editor e histórico
- `src/App.tsx`: interface, inspector e timeline

## Créditos

O fluxo de texto para keyframes foi inspirado pelo projeto MIT [Kirakun0328/text-to-vrma](https://github.com/Kirakun0328/text-to-vrma). Consulte `THIRD_PARTY_NOTICES.md`.

## Licença

MIT
