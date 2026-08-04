# VRM Pose Mode

Editor desktop para carregar modelos **VRM**, criar poses e animações por keyframes e exportar o resultado como **VRM Animation (`.vrma`)**.

## Recursos

- Carregamento por botão ou arrastar e soltar: `.vrm`, `.glb` e `.gltf`
- Mapeamento automático dos ossos humanoides de modelos VRM
- Seleção visual dos ossos no viewport e lista organizada por grupos
- Gizmos locais de rotação e translação do quadril
- Inspector numérico de rotação e posição
- Biblioteca de poses iniciais
- Timeline com keyframes, reprodução, loop, FPS e duração configuráveis
- Interpolação suave durante a edição
- Desfazer e refazer alterações da timeline
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

## Fluxo rápido

1. Clique em **Abrir modelo** e selecione um `.vrm`.
2. Escolha um osso na lista ou clique nos pontos do esqueleto.
3. Rotacione com o gizmo ou use o inspector numérico.
4. Posicione a timeline e clique em **Keyframe**.
5. Repita para criar o movimento.
6. Use **Exportar VRMA**.

## Observações

- A exportação `.vrma` requer um modelo VRM com humanoide válido carregado.
- Arquivos GLB/GLTF podem ser visualizados e manipulados, mas não possuem necessariamente o mapeamento humanoide necessário para VRMA.
- O projeto JSON salva a animação e as configurações, mas não incorpora o arquivo do modelo por questões de tamanho e licença.
- Para `.gltf` com texturas externas, prefira converter para `.glb` ou `.vrm`, pois o seletor abre um único arquivo.

## Atalhos

- `Espaço`: reproduzir/pausar
- `R`: gizmo de rotação
- `G`: mover o quadril
- `K`: adicionar/atualizar keyframe
- `Ctrl+Z`: desfazer
- `Ctrl+Y` ou `Ctrl+Shift+Z`: refazer

## Estrutura

- `electron/`: janela desktop e controles nativos
- `src/components/Viewport.tsx`: cena Three.js, carregamento VRM e manipulação
- `src/lib/vrmaExporter.ts`: gerador GLB/VRMA 1.0
- `src/store.ts`: estado do editor e histórico
- `src/App.tsx`: interface, inspector e timeline

## Licença

MIT
