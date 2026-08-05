# Pose por referência

Este módulo cria poses e movimentos VRM a partir de imagem, GIF ou vídeo.

## Motores disponíveis

### Pose por referência — rápido

Usa MediaPipe Pose Landmarker no renderer do Electron. É indicado para prévia rápida e computadores mais fracos.

### RTMW3D HQ — alta qualidade

Usa MediaPipe Lite somente para localizar a pessoa e executa RTMW3D-x ONNX para calcular 133 pontos de corpo inteiro em 3D. No Windows, o processo principal tenta usar ONNX Runtime com DirectML; se isso falhar, o painel informa o fallback para CPU.

## Fluxo comum

1. O arquivo é decodificado localmente.
2. O motor escolhido detecta a pose corporal.
3. O retargeter converte os eixos do corpo para rotações do humanoide normalizado VRM.
4. Imagens geram um keyframe no cursor atual. GIFs e vídeos geram uma sequência de keyframes.
5. Os keyframes importados continuam sendo keyframes comuns do editor e podem ser corrigidos manualmente.

## Privacidade e dependências

O arquivo escolhido não é enviado para servidor. Os runtimes e pesos necessários são obtidos na primeira utilização e reutilizados localmente.

O peso RTMW3D-x não é armazenado no Git por causa do tamanho. Ele é baixado para a pasta de dados do aplicativo, com download temporário seguro e reaproveitamento offline.

## Limites intencionais

- captura de uma pessoa;
- profundidade estimada por uma única câmera;
- resultados de baixa confiança preservam a rotação anterior para evitar saltos;
- a conversão atual usa corpo, cabeça, mãos e pés para o humanoide VRM, mas ainda não gera animação individual de todos os dedos ou expressões faciais;
- a qualidade final deve ser revisada e pode ser corrigida manualmente no editor.

## Histórico

Uma importação inteira entra no histórico como uma única ação de desfazer/refazer.
