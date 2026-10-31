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
