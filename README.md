# VRM Pose Mode

Editor desktop para carregar modelos **VRM**, criar poses e animações por keyframes e exportar o resultado como **VRM Animation (`.vrma`)**.

## Recursos atuais

- Carregamento por botão ou arrastar e soltar: `.vrm`, `.glb` e `.gltf`
- Mapeamento automático dos ossos humanoides de modelos VRM
- Seleção visual dos ossos no viewport e lista organizada por grupos
- Gizmos locais de rotação e translação do quadril
- Inspector numérico de rotação e posição
- Biblioteca de poses iniciais
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

## Fluxo manual

1. Clique em **Abrir modelo** e selecione um `.vrm`.
2. Escolha um osso na lista ou clique nos pontos do esqueleto.
3. Rotacione com o gizmo ou use o inspector numérico.
4. Posicione a timeline e clique em **Keyframe**.
5. Repita para criar o movimento.
6. Use **Exportar VRMA**.

## Direção do editor

A geração de animação por texto foi removida. Criar rotações de todos os ossos a partir de uma descrição não ofereceu previsibilidade suficiente para um editor de animação.

A direção recomendada para tornar a criação mais fácil é:

- importar movimentos humanoides já existentes;
- usar uma biblioteca de movimentos e poses reutilizáveis;
- editar o corpo com controles IK de mãos, pés, cabeça e quadril;
- manter os keyframes totalmente editáveis antes da exportação.

Esses recursos devem ser implementados diretamente sobre o humanoide normalizado do VRM, sem depender de um modelo de linguagem para inventar ângulos de ossos.

## Observações

- A exportação `.vrma` requer um modelo VRM com humanoide válido carregado.
- Arquivos GLB/GLTF podem ser visualizados e manipulados, mas não possuem necessariamente o mapeamento humanoide necessário para VRMA.
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
- `src/lib/poseRetargeter.ts`: adaptação experimental de pose capturada para VRM
- `src/lib/vrmaExporter.ts`: gerador GLB/VRMA 1.0
- `src/store.ts`: estado do editor e histórico
- `src/App.tsx`: interface, inspector e timeline

## Licença

MIT
