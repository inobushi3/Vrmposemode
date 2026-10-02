# FrameLens

Aplicativo desktop para capturar uma janela de jogo, reconhecer a fala que aparece na caixa de diálogo e traduzir o texto para português.

## O que já existe

- seleção manual entre janelas abertas e monitores;
- prévia ao vivo da janela escolhida;
- área de OCR visível sobre a imagem;
- seleção manual da área exata onde as letras aparecem;
- sugestão automática de uma região provável de diálogo;
- OCR local com Tesseract.js;
- idiomas: inglês, português, japonês, espanhol, francês e alemão;
- tratamento específico para texto de diálogo;
- filtro de caracteres e segunda tentativa automática quando a confiança do OCR está baixa;
- detecção visual de nova fala: não executa OCR em um cronômetro;
- espera a caixa de diálogo estabilizar antes de reconhecer o texto;
- tradução automática para português após uma nova leitura válida;
- exibição separada de tradução e texto original;
- confiança aproximada do OCR;
- histórico das últimas falas e botão para copiar a tradução;
- layout responsivo para janelas menores.

## Rodar no Windows

Requer Node.js 20+.

Abra CMD ou PowerShell na pasta do projeto e rode:

```bash
npm install
npm start
```

`npm install` só é necessário na primeira vez ou quando as dependências mudarem. Depois disso, normalmente basta:

```bash
npm start
```

Na primeira leitura de cada idioma, o Tesseract pode precisar baixar os dados daquele idioma. Depois eles ficam em cache no diretório de dados do aplicativo.

A tradução para português usa conexão com a internet. Se a tradução falhar, o texto original reconhecido continua visível.

## Como usar

1. Abra o jogo.
2. Abra CMD ou PowerShell na pasta do FrameLens e execute `npm start`.
3. Em **Aplicativo**, escolha manualmente a janela do jogo.
4. Clique em **Conectar ao jogo**.
5. Clique em **Marcar área** e arraste somente sobre a área onde as letras da fala aparecem.
6. Evite incluir retrato do personagem, HUD, nome decorativo e molduras sempre que possível.
7. Deixe **Texto de diálogo** como tratamento inicial.
8. Com **Detectar nova fala** ligado, o FrameLens observa mudanças leves na região e só executa OCR quando uma fala nova aparece e estabiliza.
9. **Ler agora** força uma leitura manual a qualquer momento.

## Sobre a precisão

A precisão melhora bastante quando a seleção é justa ao texto. Selecionar a caixa inteira junto com personagens, ícones e desenhos faz o OCR tentar interpretar esses elementos como letras.

Para inglês, o FrameLens filtra símbolos improváveis e tenta outro modo de segmentação automaticamente quando a primeira leitura tem confiança baixa.

## Limitações atuais

- alguns jogos com conteúdo protegido ou métodos de renderização específicos podem retornar uma captura preta;
- o primeiro uso de um idioma pode exigir internet para baixar os dados do OCR;
- a tradução depende de conexão com a internet;
- a sugestão automática de área é heurística e pode precisar de ajuste manual em interfaces muito decoradas.
