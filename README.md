# VRM Pose Mode

Editor desktop para carregar modelos **VRM**, importar e editar movimentos humanoides e exportar o resultado como **VRM Animation (`.vrma`)**.

## Recursos atuais

- Carregamento por botão ou arrastar e soltar: `.vrm`, `.glb` e `.gltf`
- Mapeamento automático dos ossos humanoides de modelos VRM
- Seleção visual dos ossos no viewport e lista organizada por grupos
- Gizmos locais de rotação e translação do quadril
- Inspector numérico de rotação e posição
- Biblioteca de poses iniciais
- Biblioteca local persistente de arquivos `.vrma`
- Importação oficial `VRMC_vrm_animation` usando `@pixiv/three-vrm-animation`
- Conversão de VRMA para keyframes comuns e totalmente editáveis
- Root motion opcional, escala de deslocamento e amostragem em 15/30/60 FPS
- Timeline com keyframes, reprodução, loop, FPS, duração, zoom e arraste de keyframes
- Interpolação suave durante a edição
- Desfazer e refazer alterações da timeline
- Criação experimental de pose ou movimento por imagem, GIF e vídeo
- Captura corporal RTMW3D-x local com ONNX Runtime e DirectML no Windows
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

## Fluxo recomendado

1. Clique em **Abrir modelo** e selecione um `.vrm`.
2. Clique em **Movimentos**.
3. Use **Importar VRMA** e selecione um arquivo `.vrma`.
4. O arquivo é validado e salvo na biblioteca local do aplicativo.
5. Escolha 30 FPS, mantenha root motion quando desejar deslocamento e aplique na timeline.
6. Ajuste qualquer osso ou keyframe manualmente.
7. Exporte o resultado novamente como VRMA.

A biblioteca usa IndexedDB e permanece somente neste computador. O arquivo VRMA não é enviado para serviços externos.

## Como a importação funciona

O carregador oficial converte o arquivo em canais do humanoide normalizado VRM:

- rotações são associadas pelos nomes oficiais dos ossos humanoides;
- somente ossos disponíveis no modelo aberto são importados;
- a posição absoluta do quadril do arquivo é convertida para deslocamento relativo à T-pose;
- a animação é amostrada no FPS escolhido e transformada em keyframes do editor;
- timelines muito grandes são limitadas automaticamente;
- expressões faciais e look-at são informados, mas ainda não entram na timeline corporal.

## Fluxo manual

1. Escolha um osso na lista ou clique nos pontos do esqueleto.
2. Rotacione com o gizmo ou use o inspector numérico.
3. Posicione a timeline e clique em **Keyframe**.
4. Repita para criar ou corrigir o movimento.
5. Use **Exportar VRMA**.

## Direção do editor

A geração de animação por texto foi removida. O fluxo principal agora usa movimentos humanoides reais e previsíveis.

Ordem de desenvolvimento:

1. importação e biblioteca VRMA — implementada;
2. controles IK para mãos, pés, cabeça e quadril;
3. sequenciador de blocos e transições entre movimentos;
4. importação BVH;
5. importação FBX/Mixamo com mapeamento explícito;
6. captura por imagem/vídeo mantida como ferramenta experimental.

## Observações

- A aplicação e a exportação `.vrma` exigem um modelo VRM com humanoide válido carregado.
- Arquivos GLB/GLTF podem ser visualizados e manipulados, mas não possuem necessariamente o mapeamento humanoide necessário.
- O projeto JSON salva a animação e as configurações, mas não incorpora o arquivo do modelo por questões de tamanho e licença.
- Para `.gltf` com texturas externas, prefira converter para `.glb` ou `.vrm`, pois o seletor abre um único arquivo.
- A captura por imagem e vídeo permanece experimental; resultados 2D/3D não garantem retargeting perfeito em todos os avatares.

## Atalhos

- `Espaço`: reproduzir/pausar
- `R`: gizmo de rotação
- `G`: mover o quadril
- `K`: adicionar/atualizar keyframe
- `Ctrl+Z`: desfazer
- `Ctrl+Y` ou `Ctrl+Shift+Z`: refazer

## Estrutura

- `electron/`: janela desktop e serviços nativos do RTMW3D
- `src/components/Viewport.tsx`: cena Three.js, carregamento VRM e manipulação
- `src/components/MotionLibraryStudio.tsx`: biblioteca local e aplicação dos movimentos
- `src/lib/vrmaImporter.ts`: carregamento oficial e conversão em keyframes
- `src/lib/motionLibrary.ts`: persistência dos arquivos em IndexedDB
- `src/lib/poseRetargeter.ts`: adaptação experimental de pose capturada para VRM
- `src/lib/vrmaExporter.ts`: gerador GLB/VRMA 1.0
- `src/store.ts`: estado do editor e histórico
- `src/App.tsx`: interface, inspector e timeline

## Licença

MIT
