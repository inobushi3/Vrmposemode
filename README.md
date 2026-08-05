# VRM Pose Mode

Editor desktop para carregar modelos **VRM**, criar poses e animações por keyframes e exportar o resultado como **VRM Animation (`.vrma`)**.

## Recursos

- Carregamento por botão ou arrastar e soltar: `.vrm`, `.glb` e `.gltf`
- Mapeamento automático dos ossos humanoides de modelos VRM
- Uso dos `normalizedHumanBones` para aplicar poses compatíveis entre modelos
- Normalização de VRM 0.x e VRM 1.0 para a mesma orientação frontal `+Z`
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
- Motor híbrido: LLM planeja ações semânticas e o app executa movimentos conhecidos de forma determinística
- Caminhada/corrida com quantidade de passos, direção e deslocamento definidos pelo app
- Poses finais determinísticas, incluindo heroica, fofa e relaxada
- Validação anatômica, limites articulares e revisão opcional em duas etapas
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

O LLM não controla diretamente caminhada, corrida e poses conhecidas. Ele produz um plano semântico, por exemplo:

```json
{
  "actions": [
    { "type": "walk", "steps": 2, "direction": "forward" },
    { "type": "heroPose" }
  ]
}
```

O app converte esse plano em keyframes determinísticos usando a convenção oficial do humanoide VRM:

- `forward` = `+Z` local do avatar;
- `backward` = `-Z`;
- `left` = `+X`;
- `right` = `-X`;
- distâncias em metros;
- rotações relativas à T-pose normalizada.

Assim, um modelo gratuito que erre ângulos ainda não consegue inverter a direção da caminhada nem remover uma pose final reconhecida. Keyframes livres do LLM são aceitos apenas como detalhes e não sobrescrevem ações determinísticas.

As ações atualmente compiladas pelo app são:

- caminhar;
- correr;
- pose heroica;
- pose fofa;
- pose relaxada;
- acenar;
- fazer reverência;
- pular;
- girar;
- assentir;
- negar com a cabeça;
- agachar.

Somente a descrição textual é enviada ao provedor escolhido. O arquivo VRM permanece local.

## Compatibilidade VRM

O sexo ou o estilo visual do avatar não altera o mapeamento. Modelos femininos, masculinos ou estilizados usam os mesmos nomes humanoides definidos pelo VRM. O que importa é o arquivo possuir um humanoide VRM válido com os ossos obrigatórios.

O app utiliza o mapeamento fornecido pelo próprio arquivo, em vez de tentar adivinhar ossos pelo nome da malha. Modelos VRM 0.x são rotacionados para a orientação frontal de VRM 1.0 antes da edição.

## Observações

- A exportação `.vrma` requer um modelo VRM com humanoide válido carregado.
- Arquivos GLB/GLTF podem ser visualizados e manipulados, mas não possuem necessariamente o mapeamento humanoide necessário para VRMA.
- O projeto JSON salva a animação e as configurações, mas não incorpora o arquivo do modelo por questões de tamanho e licença.
- Para `.gltf` com texturas externas, prefira converter para `.glb` ou `.vrm`, pois o seletor abre um único arquivo.
- O modo RTMW3D e o modo por texto são independentes: RTMW3D estima pose a partir de mídia; o gerador textual planeja e compila ações.
- Movimentos não presentes na biblioteca semântica ainda podem usar keyframes livres e podem exigir correção manual.

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
- `src/lib/proceduralMotion.ts`: ações semânticas determinísticas
- `src/lib/textMotion.ts`: validação e compilação em keyframes editáveis
- `src/lib/vrmaExporter.ts`: gerador GLB/VRMA 1.0
- `src/store.ts`: estado do editor e histórico
- `src/App.tsx`: interface, inspector e timeline

## Créditos

O fluxo de texto para keyframes foi inspirado pelo projeto MIT [Kirakun0328/text-to-vrma](https://github.com/Kirakun0328/text-to-vrma). Consulte `THIRD_PARTY_NOTICES.md`.

## Licença

MIT
