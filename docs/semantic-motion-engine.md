# Motor semântico de movimento VRM

## Motivo

Pedir a um LLM para inventar diretamente todos os ângulos de uma animação é instável. Um modelo pode inverter direção, omitir uma ação ou gerar rotações incompatíveis com a convenção normalizada do VRM.

O gerador textual agora usa uma arquitetura híbrida:

1. o LLM converte a descrição em ações semânticas;
2. um parser local garante que ações explícitas não sejam omitidas;
3. o aplicativo compila ações conhecidas em keyframes determinísticos;
4. detalhes livres do LLM podem complementar o resultado, mas não sobrescrevem direção, locomoção ou pose final.

## Convenção

O motor opera no humanoide normalizado usado por `@pixiv/three-vrm`:

- pose de repouso T-pose;
- frente local em `+Z`;
- trás em `-Z`;
- esquerda em `+X`;
- direita em `-X`;
- altura em `+Y`;
- translação do quadril em metros.

Modelos VRM 0.x são normalizados durante o carregamento com `VRMUtils.rotateVRM0`.

## Ações determinísticas

- `walk`
- `run`
- `heroPose`
- `relaxedPose`
- `cutePose`
- `wave`
- `bow`
- `jump`
- `turn`
- `nod`
- `shakeHead`
- `crouch`

## Exemplo

Entrada:

```text
Dê 2 passos para frente e depois faça uma pose de herói.
```

Plano garantido pelo parser local:

```json
{
  "actions": [
    { "type": "walk", "steps": 2, "direction": "forward" },
    { "type": "heroPose" }
  ]
}
```

A caminhada produz exatamente dois ciclos de passo e avança o quadril no eixo local `+Z`. A posição alcançada é preservada durante a transição para a pose heroica. A pose heroica usa os mesmos eixos e ângulos já usados pela biblioteca de poses do editor.

## Compatibilidade

O sexo e o estilo visual do avatar não alteram o mapeamento humanoide. Para geração corporal completa, o arquivo precisa fornecer os ossos humanoides obrigatórios do VRM. O compilador recusa modelos incompletos em vez de gerar uma animação silenciosamente quebrada.
