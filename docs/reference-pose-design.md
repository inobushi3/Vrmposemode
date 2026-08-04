# Pose por referência

Este módulo cria poses e movimentos VRM a partir de imagem, GIF ou vídeo.

## Fluxo

1. O arquivo é decodificado localmente no renderer do Electron.
2. O MediaPipe Pose Landmarker detecta 33 pontos corporais em coordenadas de imagem e coordenadas 3D.
3. O retargeter converte os eixos do corpo para rotações do humanoide normalizado VRM.
4. Imagens geram um keyframe no cursor atual. GIFs e vídeos geram uma sequência de keyframes.
5. Os keyframes importados continuam sendo keyframes comuns do editor e podem ser corrigidos manualmente.

## Privacidade e dependências

O arquivo escolhido não é enviado para servidor. Na primeira utilização, o runtime WASM e o modelo oficial do MediaPipe são obtidos dos servidores oficiais e ficam sujeitos ao cache do Electron.

## Limites intencionais desta etapa

- captura corporal de uma pessoa;
- sem dedos individuais;
- sem expressões faciais;
- profundidade estimada por uma única câmera;
- resultados de baixa confiança preservam a rotação anterior para evitar saltos.

## Histórico

Uma importação inteira entra no histórico como uma única ação de desfazer/refazer.
