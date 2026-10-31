# Inspiração: mascote na ilha (estilo Grok Bot / novra.design)

> Pesquisa de 31/10/2026, a partir dos prints que o Eduardo mandou (post da novra.design + ab.w…).

## O que os prints mostram

| Estado | O que aparece | Como fica no Nimbo |
|---|---|---|
| Fechado | Ilha preta fina com o bichinho à esquerda e 4 bolinhas coloridas à direita (uma por agente) | Ilha fechada com o mascote no lugar do anel e pontos coloridos por agente ativo |
| Trabalhando | Bichinho grande com um ponto azul de "fala"; lista de passos ("Start working…", **Prep workspace**, "Copy final outputs") com o passo atual em destaque | Página Agentes / ilha aberta com o mascote e o plano do agente (já temos `set_plan`) |
| Vários agentes | Pílulas lado a lado, cada uma com um mini-bichinho de cor própria: "Asking Research", "Sending to C…", "Pinging Travel", "Looping in Co…" | Pílulas por agente com cor, forma e frase curta do passo atual |
| Erro | Cartão alaranjado: "Grok Bot couldn't finish setting up" + subtítulo vermelho + botão de tentar de novo; o bichinho fica com olhos fechados (—  —) e um ponto vermelho | Estado de erro com olhos fechados, texto curto e botão "Tentar de novo" |
| Concluído (widget) | Bichinho branco grande, ponto verde, "✓ Done" | Estado "pronto" com check verde; some sozinho depois de um tempo |
| Grade | 4 bichinhos de cores e formas diferentes (verde-água, laranja, vermelho, roxo), cada um com olhar diferente | Cada agente ganha uma cor e uma forma fixas |

Ideia central: **um personagem simples (forma sólida + dois olhos recortados) que pisca, olha para o cursor e muda de "humor" conforme o agente está pensando, trabalhando, esperando você, pronto ou com erro.**

## Mais imagens e vídeos para olhar

- Post original da novra.design (Instagram, 29/09) — o que você mandou; a novra conta que fez o sistema de status em **Rive** (notch, widgets e Live Activities).
- [60fps.design — animações do app Grok Bot](https://60fps.design/apps/grok-bot) (mascotes piscando e mudando o olhar na abertura).
- [Grok Bot 3D interativo](https://lenxism.github.io/grok-bot-mascot-3d/) (expressões Idle, Happy, Blink, Look; movimentos Bounce, Spin, Nod, Wave).
- [Gerador de mascote estilo Grok Bot com 20+ expressões](https://x.com/BuildwithOmkarr/status/2088367241742205312) (envia um SVG, ajusta os olhos, baixa o código).
- [Grok Bot Mascot Customizer — modelo 3D](https://makerworld.com/en/models/3236977-grok-bot-mascot-customizer).
- [Rive Marketplace — mascote nuvem com 6 expressões e state machine](https://rive.app/marketplace/27043-50911-rive-app-mascot-cloud-character-with-state-machine-and-6-expressions/) (ótimo exemplo de "nuvem com humor", combina com o nome Nimbo; conferir a licença do arquivo).
- [AgentsRoom — Live Activities de agentes](https://agentsroom.dev/docs/live-activities) (anel de progresso + timer + "esperando você").
- [Lenny's Newsletter — como os designers do Grok Bot trabalham](https://www.lennysnewsletter.com/p/how-grok-bot-designers-use-ai-agents) (origem da ideia do bot no notch, por John Bai).

## Código aberto que ajuda

| Projeto | Licença | O que aproveitar |
|---|---|---|
| [jeremy-prt/bloub](https://github.com/jeremy-prt/bloub) | MIT (só o código) | **Técnica**: corpo que é quase um círculo e muda de forma por "perfil radial", olhos como furos (máscara) inclinados ~26°, piscar e olhar à deriva, motor que é função pura do tempo (`engine.sample(t)`), sem biblioteca de animação. Vue, mas o motor é independente de framework. |
| [Radial01/grokbot-notch](https://github.com/Radial01/grokbot-notch) (fork de robzilla1738) | MIT | `motion-lab.js`: 25 formas procedurais (hex, pebble, cloud, squircle, teardrop, star, wedge, blob…), olhos recortados, piscar, olhar seguindo o cursor; estados idle / listening / thinking / streaming / working. É HTML+JS dentro de WebView, igual ao nosso. |
| [JorgeBelmarEscalona/omarchy-agent-notch](https://github.com/JorgeBelmarEscalona/omarchy-agent-notch) | MIT | Lista de estados completa (idle, thinking, working, waiting, done, error, sleep), rostos que seguem o cursor e ficam "tontos" com cliques repetidos, servidor MCP, hooks do Claude Code. |
| [realfishsam/agent-notch](https://github.com/realfishsam/agent-notch) | MIT | Regra de "pronto desde a última vez que você olhou" e detecção sem hooks (processo vivo + transcript escrito nos últimos 30 s). |
| [codepeek-labs/codepeek](https://github.com/codepeek-labs/codepeek) | MIT | **Roda no Windows.** Hooks do Claude Code/Codex, cartões de aprovação, cores por ferramenta (Bash verde, Edit azul, Read amarelo, Grep roxo, Agent laranja). |
| [AIMO no 21st.dev](https://21st.dev/@nrmk13/components/aimo) | MIT | Rosto de agente em um arquivo React: pisca, olha para o ponteiro, pausa fora da tela. |
| [rive-app/rive-react](https://github.com/rive-app/rive-react) | (conferir) | Se um dia o mascote for desenhado no Rive, o React toca a state machine com `useStateMachineInput`. |
| [sk-ruban/notchi](https://github.com/sk-ruban/notchi) | **GPL-3.0** | **Só olhar ideias** (humor pelo sentimento da conversa, um sprite por sessão). Não copiar código. |

## Cuidado com marca

O personagem do Grok Bot é da xAI. Até os projetos MIT avisam que a licença cobre só o código, não o desenho. Então o Nimbo deve ter **o próprio mascote**: o mesmo estilo (forma sólida, olhos recortados, piscar, olhar) com forma e cores nossas. Sugestão: uma **nuvenzinha** ("Nimbo" = nuvem), e cada agente ganha uma variação de forma e cor.

## Plano para o Nimbo

> 31/10/2026: passos 1 a 5 feitos (`src/mascot/`, humores em `src/agents/moods.ts`, galeria em `?window=mascots` no modo dev). Falta o 6.

1. **Motor do mascote** (`src/mascot/`): SVG procedural feito do zero, inspirado na técnica do bloub e do motion-lab (perfil radial que se transforma, olhos como máscara, piscar, olhar seguindo o cursor, função pura do tempo, pausa com "reduzir movimento").
2. **Humores** ligados aos agentes: ocioso, pensando (olhos olhando para cima e balanço lento), trabalhando (pulinho e ponto azul), esperando você (olhar fixo e ponto laranja), pronto (olhos felizes e check verde), erro (olhos fechados e ponto vermelho), dormindo.
3. **Ilha fechada**: mascote à esquerda e um ponto colorido por agente à direita, como no print.
4. **Ilha aberta**: pílulas por agente (mini-mascote + frase do passo atual), o plano com o passo atual em destaque, e o cartão de erro com "Tentar de novo".
5. **Pedidos de aprovação**: o mascote "olha para você" e mostra Aprovar e Recusar (já existe `request_approval`).
6. **Detecção sem MCP** (opcional): igual ao agent-notch, olhar `~/.claude/projects/*.jsonl` para saber se o Claude Code está trabalhando, mesmo sem configurar nada.

## Engenharia reversa visual aplicada (31/10/2026)

- **Barra superior** (todas as páginas com `PageChrome`): ícones redondos de 22 px à esquerda (o ativo vira um disco branco) e, à direita, tempo, bateria e hora. Saíram as setas laterais e os pontinhos de baixo.
- **Tokens** em `src/island/IslandBar.css`: `--g-card` (degradê #1d1e22 → #16171a), borda 7% branca, raio 18 px, pílulas #222327, textos em três tons.
- **Agentes**: cartão de foco (mascote de 64 px com brilho do humor + 3 passos, o atual em negrito) e cartão de pílulas 2×2. O erro vira um cartão inteiro com degradê quente e botão redondo.
- **Sistema, Agenda, Lançador e Prateleira**: margens de 22 px, cartões e pílulas no mesmo estilo; botões ligados em branco.
- **Tema "Noir"** (#0A0A0D) para o fundo quase preto da referência.
- Música, Casa, Tarefas e Assistente também passaram para a barra nova (componente `IslandBar`); o player e o chat foram realinhados às margens de 22–26 px.

## Engenharia reversa do vídeo completo (reel ab.workss × novra.design, 53 s)

| Tempo | Estado | O que acontece | Como fica no Nimbo |
|---|---|---|---|
| 0 s | Normal | Mascote pequeno dentro do notch | Ilha fechada mínima com o mascote |
| 3 s | **Greeting** | A ilha abre num cartão único; o mascote no centro acena com duas "mãozinhas", com brilho quente | Tela inicial sem nada acontecendo: cartão único com o mascote acenando |
| 6 s | **Idle** | Pílula larga ao redor do notch: mascote com brilho azul à esquerda, grade 2×2 de pontos coloridos à direita | Ilha fechada: mascote sempre à esquerda e grade de pontos (agentes ou módulos ativos) à direita |
| 10 s | **Working** | Cartão com o mascote e 3 passos (o atual em destaque) + cartão de pílulas coloridas | Tela inicial com coisas acontecendo e a página Agentes |
| 14 s | **Slapp** | Clicar várias vezes no mascote deixa ele tonto; o cartão ganha degradê rosa-roxo e uma mensagem engraçada; os mini-mascotes ficam numa coluna à direita | Clique repetido no mascote = humor "tonto" com mensagem |
| 22–25 s | **Error** | Mascote rosado, olhos fechados, ponto vermelho; cartão com degradê quente, título, subtítulo vermelho e botão redondo de tentar de novo | Já feito na página Agentes |
| 29 s | **Uploading** | Cartão com degradê verde embaixo, "Uploading Project Files", barra de progresso com o mascote andando em cima, porcentagem | Foco e downloads: cartão de progresso com o mascote na barra |
| 34–38 s | **Annoyed** | Cursor parado em cima do mascote: olhos semicerrados | Passar o mouse muito tempo em cima = olhos semicerrados |
| 43 s | **Task finished** | Ilha fechada com o mascote olhando para cima, ponto verde e brilho verde | Humor "pronto" na ilha fechada |
| 48 s | Drag and drop | O mascote sai do notch e vai para cima das janelas | Ideia para depois (precisa de janela própria) |

Barra superior do painel aberto: **só 3 ícones à esquerda** (início ativo em disco branco, chat, "+") e, à direita, nuvem, engrenagem, bússola, "100%" e a bateria.

## GrokBot Meter (popover da barra de menus)

Cabeçalho com o ícone do bot, título, engrenagem e fechar. Cartão 1: rótulo pequeno em maiúsculas ("WEEKLY"), número grande (68%), ilustração no centro (copo), valor no canto ("$12.40 / $50.00 ON-DEMAND"), régua de nível (small, **regular**, large) e "dias para zerar" em 7 bolinhas, com a atual em verde; "Resets in 3d · Updated 9:54 PM". Cartão 2: "TODAY 12 msg", "12 messages · 3 agents", linhas com ponto verde, nome, selo verde com número e hora; seção "Recent" em cinza. Rodapé com 3 botões em pílula cinza (About, Refresh, Quit). Para o Nimbo: a página Água vira um "medidor" nesse estilo (o copo d'água já existe).
