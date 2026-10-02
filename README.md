# FrameLens

Aplicativo desktop para capturar uma janela de jogo e reconhecer apenas o texto da caixa de diálogo escolhida pelo usuário.

O repositório foi reiniciado como um projeto novo. A versão atual é um MVP funcional focado em três coisas: seleção manual da janela, recorte preciso da área de diálogo e OCR local.

## O que já existe

- seleção manual entre janelas abertas e monitores;
- prévia ao vivo da janela escolhida;
- área de OCR visível sobre a imagem;
- seleção manual da caixa de diálogo arrastando o mouse;
- sugestão automática de uma região provável de diálogo;
- OCR local com Tesseract.js;
- idiomas: inglês, português, japonês, espanhol, francês e alemão;
- modos de imagem Natural, Contraste leve e Preto e branco;
- leitura manual ou automática com intervalo configurável;
- confiança aproximada do OCR;
- histórico das últimas leituras e botão de copiar;
- layout responsivo para janelas menores;
- interface própria em carvão, creme, sálvia e laranja, sem estética roxa/genérica de app de IA.

## Rodar no Windows

Requer Node.js 20+.

```bash
npm install
npm start
```

Na primeira leitura de cada idioma, o Tesseract pode precisar baixar os dados daquele idioma. Depois eles ficam em cache no diretório de dados do aplicativo.

## Gerar instalador

```bash
npm run dist
```

O Electron Builder gera um instalador NSIS do Windows na pasta `dist`.

## Como usar

1. Abra o jogo.
2. Abra o FrameLens.
3. Em **Aplicativo**, escolha manualmente a janela do jogo.
4. Clique em **Conectar ao jogo**.
5. Clique em **Marcar área** e arraste exatamente sobre a caixa de diálogo.
6. Escolha o idioma e o tratamento de imagem.
7. Use **Ler agora** ou mantenha a leitura automática ligada.

## Sobre a precisão

OCR de jogos varia muito conforme fonte, contorno, transparência, resolução e animações. Por isso o FrameLens não depende apenas de detecção automática: a área manual permite excluir HUD, nomes de personagens, minimapa e outros elementos que normalmente pioram o reconhecimento.

Para texto com borda forte ou fundo translúcido, comece com **Contraste leve**. O modo **Preto e branco** pode ajudar em caixas muito limpas, mas pode piorar fontes coloridas.

## Limitações atuais do MVP

- alguns jogos com conteúdo protegido ou métodos de renderização específicos podem retornar uma captura preta;
- o primeiro uso de um idioma pode exigir internet para baixar os dados do OCR;
- a sugestão automática de caixa de diálogo é heurística e deve ser refinada manualmente quando necessário;
- ainda não há tradução: esta primeira versão foca em capturar e reconhecer o texto corretamente.

## Próximos passos naturais

- persistir configuração por jogo (janela, idioma, região e filtros);
- detectar mudança real na caixa de diálogo antes de rodar OCR novamente;
- filtros específicos para texto com outline/sombra;
- suporte a múltiplas regiões, por exemplo nome do personagem + fala;
- modo overlay opcional;
- empacotar dados de idiomas selecionados para um modo 100% offline.
