# Auto VRM Converter

Aplicativo desktop experimental para analisar pacotes de personagens 3D feitos para Unity e automatizar a conversão possível para:

- **VRM 1.0**: modelo humanoide;
- **VRMA**: animações humanoides separadas.

O aplicativo não altera o pacote original. Ele cria um workspace temporário, preserva arquivos `.meta`, reconstrói referências GUID, prepara um projeto Unity e executa um worker em batch mode usando UniVRM.

## Estado atual — MVP 0.1

Funciona agora:

- leitura de ZIP, pasta ou arquivo individual;
- classificação de modelos, animações, texturas, materiais, shaders, prefabs, áudio e scripts;
- inspeção básica de FBX, GLB/GLTF, VRM e VRMA;
- análise de dependências Unity por GUID;
- escolha manual do melhor candidato de modelo;
- seleção das animações que serão processadas;
- criação automática de projeto Unity 2022.3+;
- instalação do UniVRM 0.131.0 por UPM;
- configuração de FBX como Humanoid;
- retarget de FBX de animação para o Avatar principal;
- exportação de modelo humanoide como VRM 1.0;
- exportação de `AnimationClip`, FBX, BVH e VRMA existente;
- logs e relatório JSON reais do worker Unity.

Ainda precisa evoluir:

- mapeamento visual de ossos quando o Avatar automático falha;
- presets VRM de expressão a partir de blendshapes;
- spring bones automáticos para cabelo, roupa e acessórios;
- conversão avançada de lilToon/Poiyomi e outros shaders;
- associação inteligente de prefabs com roupas alternativas;
- pré-visualização 3D antes da exportação.

## Rodar

```bash
npm start
```

Na primeira execução, o script `prestart` instala dependências ausentes automaticamente.

## Fluxo

1. Abra um ZIP ou uma pasta.
2. Revise o inventário.
3. Escolha o modelo principal.
4. Marque as animações.
5. Crie o workspace.
6. Selecione um Unity Editor 2022.3 LTS ou mais recente.
7. Execute a conversão.
8. Revise `Output/`, `Conversion/unity.log` e `Conversion/unity-result.json`.

## Limitações importantes

A conversão automática depende de um esqueleto que o Unity consiga reconhecer como Humanoid. Modelos sem rig humano, com T-pose inválida, ossos ausentes ou dependências externas podem falhar. Nesse caso, o aplicativo registra a causa em vez de produzir um arquivo falso ou incompleto silenciosamente.

O usuário é responsável por ter permissão para converter e usar os modelos e animações processados.
