# Fontes técnicas do motor VRM

A implementação foi revisada usando documentação oficial do ecossistema VRM:

- `@pixiv/three-vrm` — `VRMHumanoid`, `normalizedHumanBones`, `getNormalizedBoneNode`, `getNormalizedPose` e `setNormalizedPose`.
- `VRMC_vrm.humanoid` — lista e hierarquia oficial dos ossos humanoides obrigatórios.
- `vrm.dev` — diferenças de orientação entre VRM 0.x e VRM 1.0 e exigência de T-pose.

Essas fontes fundamentam o uso de poses relativas à T-pose normalizada, a validação de ossos obrigatórios e a convenção de frente local em `+Z` após a normalização de arquivos VRM 0.x.
