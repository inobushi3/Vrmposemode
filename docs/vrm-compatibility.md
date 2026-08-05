# Compatibilidade de modelos VRM

O motor de animação não procura ossos pelo nome da malha. Ele usa o mapeamento humanoide fornecido pelo próprio arquivo VRM por meio de `@pixiv/three-vrm`.

## Modelos femininos

Corpo feminino, masculino, chibi ou estilizado utiliza o mesmo conjunto de ossos humanoides VRM. Seios, cabelo, saia, cauda, orelhas e outros ossos secundários não substituem os ossos humanoides e não são necessários para a animação corporal principal.

## Ossos obrigatórios para movimento corporal completo

- hips
- spine
- head
- leftUpperArm / leftLowerArm / leftHand
- rightUpperArm / rightLowerArm / rightHand
- leftUpperLeg / leftLowerLeg / leftFoot
- rightUpperLeg / rightLowerLeg / rightFoot

O compilador textual recusa um modelo que não possua esses ossos, em vez de gerar silenciosamente uma animação quebrada.

## Poses

As rotações são aplicadas nos ossos normalizados e são relativas à T-pose. Isso permite que a mesma animação seja reutilizada em modelos com proporções diferentes, desde que o humanoide VRM esteja configurado corretamente.
