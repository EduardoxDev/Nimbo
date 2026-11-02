# Nimbo v1.0.0: plano

> Data: 02/11/2026. Base: **v0.9.0** (publicada hoje por outra sessão no ramo `claude/untitled-session-e9dd45`, agora juntada na `main`).
> Objetivo da 1.0: **Nimbo conversa com a Alexa** e fica **estável de verdade**: sem bugs conhecidos, leve no processador, fácil de instalar e de configurar.

---

## 0. Decisões que só você toma (antes de começar)

| # | Decisão | Opções | Minha recomendação |
|---|---|---|---|
| D1 | Para quem é a skill da Alexa | **(a)** só sua, em modo de desenvolvimento (sem passar pela Amazon); **(b)** pública na loja de skills, para qualquer pessoa com Nimbo | Começar por **(a)** e ir para **(b)** na própria 1.0, depois que tudo funcionar com você |
| D2 | Onde fica o "meio de campo" (relay) entre Alexa e o PC | Cloudflare Workers; AWS (Lambda + API Gateway) | **Cloudflare**: grátis para o seu volume, um só lugar para skill e conexão do PC |
| D3 | Alexa **falar sozinha** quando algo acontece no PC (sem você perguntar) | Só o oficial (notificação com luz amarela no Echo); **ou** também o Voice Monkey (serviço de terceiros, opcional, com a sua chave) | Oficial ligado por padrão; Voice Monkey como opção desligada |
| D4 | Aprovar comandos do Claude pela voz | Nunca; com PIN falado | **Com PIN, desligado por padrão**. Qualquer pessoa na casa fala com a Alexa |

---

## 1. O que a Amazon permite hoje (pesquisa)

- **Skill personalizada (Alexa Skills Kit)** é o caminho aberto para qualquer desenvolvedor. Tem modelo de voz em **português do Brasil**. O código da skill pode ficar num serviço HTTPS próprio, no AWS Lambda ou hospedado pela Amazon.
- **Uma skill em desenvolvimento** funciona nos aparelhos da sua própria conta Amazon sem certificação. Para publicar para todos, passa por certificação e exige política de privacidade.
- **Alexa+ (a Alexa nova, com IA)** tem SDKs próprios (Category SDK e MCP Toolkit), mas **só para parceiros selecionados**. Não dá para usar agora. Fica anotado para a 1.x: quando abrir, o Nimbo já tem um servidor MCP pronto.
- **Alexa falar algo que veio de fora**: não existe API oficial de "anúncio" para skills comuns. O oficial é a **notificação proativa** (luz amarela, você pergunta "Alexa, quais são minhas notificações?"). Serviços como o **Voice Monkey** fazem a Alexa falar ou disparar rotinas por uma API HTTP, mas são de terceiros.
- **Skill de Casa Inteligente** deixa o Nimbo aparecer como "aparelhos" no app Alexa. Isso permite falar **sem** "pergunte ao Nimbo" e, principalmente, usar o Nimbo como **gatilho de rotinas** (ex.: "quando o foco terminar, acende a luz"). Exige login entre contas (OAuth).
- Limites que moldam o design: a resposta da skill precisa sair em **até ~8 segundos**. Para pedidos longos (Claude), a Alexa responde "começando" e avisa depois por notificação.

Fontes:
- [O que é o Alexa Skills Kit](https://developer.amazon.com/docs/ask-overviews/latest-tips-documentation.html)
- [Skills para o Brasil (pt-BR)](https://developer.amazon.com/blogs/alexa/post/4a557464-4cef-41ef-94da-65854a281dc2/how-to-update-your-alexa-skills-for-brazil)
- [Alexa Skills Kit em português](https://developer.amazon.com/pt-BR/alexa/alexa-skills-kit/)
- [SDKs de IA para Alexa+](https://developer.amazon.com/en-US/blogs/alexa/alexa-skills-kit/2025/02/new-alexa-announce-blog)
- [Como escolher a integração com Alexa+](https://developer.amazon.com/docs/alexaplus/add-ons/choose-the-proper-alexaplus-integration-approach.html)
- [Voice Monkey](https://voicemonkey.io/integrations/home-assistant)

> Antes de codar a fase A1, confirmo de novo na documentação da Amazon: regras de teste em modo desenvolvimento no Brasil, limites das notificações proativas e se os Durable Objects da Cloudflare continuam no plano grátis.

---

## 2. Alexa: como vai funcionar

### 2.1 Desenho

```
 Você ── "Alexa, pede pro Nimbo começar um foco"
   │
 Echo ──► Amazon (entende a frase) ──► Skill "Nimbo" (HTTPS)
                                          │
                                  Nimbo Relay (Cloudflare Worker)
                                          │  WebSocket que o PC abre (sem abrir porta no roteador)
                                          ▼
                                   Nimbo no seu PC ──► faz a ação, responde o texto
                                          │
                     Alexa fala: "Foco de 25 minutos começou."
```

Peças novas:
1. **Skill "Nimbo" em pt-BR** (modelo de voz + intents).
2. **Nimbo Relay**: um Worker com Durable Object por PC. Faz três coisas:
   - recebe as chamadas da Alexa e confere a assinatura da Amazon;
   - mantém o WebSocket aberto pelo PC;
   - envia as notificações proativas.
3. **`alexa.rs` no Nimbo**: conecta no relay, recebe pedidos, executa com as funções que já existem (foco, água, agenda, música, Claude…) e devolve a frase.

### 2.2 Ligar a Alexa ao seu PC (pareamento)
1. Configurações → **Alexa** → "Conectar". O Nimbo mostra um código de 6 números.
2. Você diz: **"Alexa, abre o Nimbo"**. Ela pede o código e você fala.
3. O relay liga a sua conta Alexa àquele PC. O código vale 10 minutos e só funciona uma vez.
4. Para desconectar: um botão no Nimbo, ou "Alexa, pede pro Nimbo desconectar".
- O token do PC fica no **Gerenciador de Credenciais do Windows**, como as outras chaves do Nimbo.

### 2.3 O que dá para falar (primeira leva)

| Área | Exemplos de frase | O que o Nimbo faz |
|---|---|---|
| Agenda | "pergunta pro Nimbo o que eu tenho hoje" / "qual meu próximo compromisso" | Lê os eventos do calendário |
| Foco | "pede pro Nimbo começar um foco" / "…de 50 minutos" / "quanto falta do foco" / "para o foco" | Pomodoro |
| Água | "fala pro Nimbo que eu bebi água" / "quanta água eu bebi hoje" | Registra um copo / lê o progresso |
| Tarefas | "pede pro Nimbo anotar comprar pão" / "quais são minhas tarefas" | To-do |
| Lembretes no PC | "pede pro Nimbo me lembrar de ligar pro João às 16h" | Usa o lembrete do Nimbo (aparece no PC) |
| Música do PC | "pede pro Nimbo pausar a música" / "próxima música" / "o que está tocando" | Controle de mídia do Windows |
| Volume | "pede pro Nimbo pôr o volume em 30" | Volume do sistema |
| Apps | "pede pro Nimbo abrir o Spotify" | Lançador |
| PC | "pede pro Nimbo bloquear o computador" | Trava a sessão do Windows |
| Claude | "pergunta pro Nimbo o que o Claude está fazendo" / "pede pro Nimbo pedir pro Claude rodar os testes" | Lê o passo atual / inicia um pedido |
| Aprovação (D4) | "pede pro Nimbo aprovar, código 4821" | Só com PIN e opção ligada |
| Resumo | "pergunta pro Nimbo como foi meu dia" | Resumo do dia |
| Mascote | "pede pro Nimbo sair para passear" / "chama o Nimbo de volta" | Nimbo livre |

- Pedido ao Claude que demora mais de 8 s: a Alexa diz "Comecei, te aviso quando terminar". Quando ele termina, chega a **notificação** no Echo, e o Nimbo livre também entrega o balão no PC.
- PC desligado ou sem internet: "Seu computador parece desligado".

### 2.4 Nimbo → Alexa (o PC avisando)
- **Oficial**: notificação proativa para o fim de um pedido do Claude, um lembrete do Nimbo, a meta de água, o fim do foco e um pedido de aprovação. Cada tipo liga e desliga separadamente.
- **Opcional (D3)**: Voice Monkey, com a chave do próprio usuário. A Alexa **fala na hora** ("O Claude terminou") e pode disparar rotinas.
- **Para quem tem Home Assistant** (o Nimbo já conversa com ele): enviar avisos pelos serviços do HA.

### 2.5 Fase "Casa Inteligente" (deixa a Alexa e as rotinas muito mais fortes)
- O Nimbo aparece no app Alexa como aparelhos:
  - interruptor **"Modo foco"**: "Alexa, liga o modo foco", sem precisar dizer "Nimbo";
  - interruptor **"Nimbo livre"**;
  - sensores virtuais **"Foco terminou"**, **"Claude terminou"** e **"Reunião começou"**.
- Nas **Rotinas da Alexa**, você usa esses sensores como gatilho. Exemplos: quando o foco termina, a luz fica verde e a Alexa diz "pausa!"; quando a reunião começa, o ar liga.
- Exige login entre contas (OAuth). O relay faz o papel de servidor de login, com Login with Amazon.

### 2.6 Segurança e privacidade
- O relay **nunca guarda** histórico de pedidos, só o vínculo entre a conta Alexa e o PC. Os logs ficam sem conteúdo de voz.
- Toda chamada da Alexa tem a assinatura da Amazon e o horário conferidos, e as antigas são recusadas.
- O WebSocket do PC usa token próprio e TLS. O relay rejeita comandos que não estejam na lista de intents.
- Ações sensíveis precisam de PIN: aprovar comandos do Claude, abrir programas e travar o PC. Cada uma liga e desliga separadamente.
- Para a skill pública (D1-b): página de política de privacidade, termos e explicação em pt-BR do que vai para a Amazon e do que vai para o relay.

### 2.7 Fases da Alexa

| Fase | Entrega | Como sei que está pronta |
|---|---|---|
| A1 | Relay no ar + skill em desenvolvimento respondendo "Nimbo está conectado" | Seu Echo responde, com o PC ligado e desligado |
| A2 | `alexa.rs` + tela de configuração + pareamento por código | Parear, desparear e reconectar sozinho depois de cair a internet ou reiniciar o PC |
| A3 | Intents da tabela 2.3 (menos Claude e aprovação) | Cada frase com teste automático de entrada e saída + teste no Echo |
| A4 | Claude pela voz + notificações proativas | Pedido longo avisa no Echo ao terminar |
| A5 | Skill de Casa Inteligente + sensores para rotinas | Uma rotina disparada pelo fim do foco funciona |
| A6 | Opcionais: Voice Monkey e Home Assistant | Anúncio falado chega no Echo |
| A7 | Publicação (se D1-b): certificação, política, ícones, textos da loja | Skill aprovada pela Amazon |

---

## 3. Caça aos bugs

### 3.1 Bugs que já conheço (vistos nesta fase)

| # | Problema | Onde | Correção planejada |
|---|---|---|---|
| B1 | Clicar no Nimbo livre tira o foco da janela que você estava usando (**corrigido na etapa 1, falta conferir no app instalado**) | `buddy.rs` | Responder `WM_MOUSEACTIVATE` com "não ativar" na janela do WebView, ou devolver o foco à janela anterior logo após o clique |
| B2 | Processador. **Etapa 1 (parcial):** janela do Nimbo livre pequena que anda com ele; sem desfoque recalculado, brilho fixo; menos envios de cursor, posição e leitura de janelas; mascote redesenha só os números. Medido lado a lado: 7,1% de um núcleo desligado e 31,1% ligado antes dos últimos cortes; amostras depois ficaram entre 26% e 36%, com muita variação | Mascote, janela transparente e comunicação com o Rust | Medir com o perfilador do navegador numa build de desenvolvimento para achar o resto. **Meta: ≤ 3% parado, ≤ 12% com Nimbo livre** |
| B3 | "Ei Nimbo" não testado com voz real; não há sinal de que está ouvindo; possível briga com o ditado pelo microfone | `speech.rs` | Ícone de "ouvindo" na ilha, teste com voz, ajuste de confiança, um só dono do microfone por vez |
| B4 | O microfone disse "reconhecimento online desligado" enquanto o Windows mostra ligado | `speech.rs` (`error_message`) | Mapear os códigos de erro de verdade, mostrar o código cru nos detalhes |
| B5 | Sessão do Claude aparece como "Parece esperando você" durante comandos longos | `sessions_watch.rs` | Usar o tipo de ferramenta e o modo de permissão; esperar mais tempo para comandos de terminal |
| B6 | Botão "Soltar o Nimbo" some quando o hub mostra agentes | `HubPanel.tsx` | Botão fixo no hub (ícone pequeno) |
| B7 | Nimbo livre, desenho na tela e captura só no monitor principal; troca de monitor nunca testada; DPI diferente entre telas | `buddy.rs`, `capture.rs` | Suporte a vários monitores e teste com 2 telas |
| B8 | Hábitos só abrem `.exe`; apps da Microsoft Store e atalhos com argumentos falham | `life/habits.ts`, `launcher.rs` | Guardar o AppID do lançador quando existir |
| B9 | `open_program` aceita qualquer `.exe` vindo da interface | `launcher.rs` | Aceitar só caminhos já vistos pelos hábitos ou pelo lançador |
| B10 | Clipe depende do atalho padrão Win+Alt+G | `capture.rs` | Avisar se o atalho do Game Bar foi trocado; estudar gravação própria |
| B11 | Resumo do dia só aparece se o app estiver aberto entre 18:00 e 18:59 | `useLifeHelpers.ts` | Mostrar ao abrir o PC depois das 18h se ainda não mostrou |
| B12 | Atualização: o instalador vem com "Desinstalar antes de instalar" marcado. Preciso confirmar que água, lembretes, tarefas e configurações sobrevivem | Instalador NSIS | Teste de atualização 0.4 → 1.0 com dados; mudar o padrão para "não desinstalar" |
| B13 | "Comer arquivos" e arremesso do Nimbo livre nunca testados ao vivo | `BuddyWindow.tsx` | Testes manuais guiados + teste automático da física |
| B14 | ~~`unwrap()` que derrubam o app~~ **Feito na etapa 1.** Fora dos testes eram só 8; os 3 de risco real (trava da janela) agora se recuperam | Rust | — |
| B15 | 81 `.catch(() => {})` na interface (contando a 0.9.0): erros somem sem aviso | React | Mandar para o log de diagnóstico; mostrar ao usuário quando for ação dele |
| B16 | ~~AGENTS.md dizia npm~~ **Feito na etapa 1.** O projeto usa pnpm (CI e release); o guia foi corrigido | Raiz | — |

### 3.2 Auditoria completa (para achar os que eu ainda não vi)

| Área | O que olhar |
|---|---|
| Ilha | Abrir e fechar, borda, bandeja, esconder em tela cheia, vários monitores, DPI 100/125/150%, tema claro e escuro |
| Música | Spotify, YouTube no navegador, sem nada tocando, troca rápida de faixa, letras |
| Claude | Fila, aprovação, desfazer, sessões paralelas, Claude não instalado, pasta sem git |
| Lembretes / agenda / reunião | Fuso, horário de verão, app fechado na hora, eventos repetidos |
| Água / foco / semana | Virada do dia, PC dormindo, dados corrompidos no armazenamento |
| Voz | Sem microfone, microfone bloqueado, sem internet, idiomas en e zh |
| Nimbo livre | Tela cheia, jogos, vários monitores, dock, barra de tarefas escondida, CPU por 1 hora |
| Atualizador | 0.4 → 1.0 com dados, sem internet, assinatura errada |
| Segurança | Servidor MCP local, token, `open_program`, captura de tela, relay da Alexa |
| Acessibilidade | Teclado em toda a ilha, leitor de tela, contraste, movimento reduzido |

Para cada área:
1. Reproduzir o problema.
2. Escrever um teste que falha.
3. Corrigir.
4. Ver o teste passar.
5. Conferir no app instalado.

---

## 4. Qualidade para merecer o "1.0"

1. **Desempenho**: metas da B2; memória abaixo de 250 MB somando todas as janelas; abrir a ilha em menos de 150 ms.
2. **Estabilidade**: zero `unwrap` fora de testes; log de diagnóstico com botão "Copiar relatório" em Configurações → Sobre.
3. **Código**:
   - quebrar o `App.tsx` (7.861 linhas na 0.9.0) e o `App.css` (4.510) por página, sem mudar comportamento;
   - quebrar o `lib.rs` (2.100).
4. **Testes**:
   - hoje são 153 da interface e 106 do Rust (0.9.0);
   - meta: lógica nova sempre com teste;
   - testes de ponta a ponta com o app real (tauri-driver);
   - teste de atualização no CI.
5. **Primeira abertura**: um passo a passo curto escolhendo idioma, cidade do tempo, Claude, Alexa e Nimbo livre.
6. **Textos e idiomas**: revisar tudo nos 3 idiomas; nenhum texto preso no código.
7. **Documentação**: README novo com GIFs, página "Como conectar a Alexa", changelog completo da 1.0.

---

## 5. Ordem de trabalho

| Etapa | Conteúdo | Resultado |
|---|---|---|
| 1 | Bugs críticos: B1, B2, B12, B14 + gerenciador de pacotes (B16) | Base estável |
| 2 | Alexa A1 + A2 (relay, skill em desenvolvimento, pareamento) | Seu Echo fala com o PC |
| 3 | Alexa A3 + A4 (intents, Claude, notificações) | Uso diário pela voz |
| 4 | Resto dos bugs (B3–B11, B13, B15) + auditoria 3.2 | Lista de bugs zerada |
| 5 | Alexa A5 (Casa Inteligente + rotinas) | Rotinas reagindo ao PC |
| 6 | Qualidade (seção 4) + primeira abertura + docs | Cara de produto |
| 7 | **v1.0.0-beta** só no seu PC por alguns dias de uso real | Achar o que sobrou |
| 8 | Alexa A6/A7 (opcionais e publicação, conforme D1/D3) + **v1.0.0** | Lançamento |

**Pronto para lançar quando**:
- nenhum bug conhecido aberto;
- todos os testes passando;
- metas de CPU batidas;
- atualização 0.4 → 1.0 sem perder dados;
- Alexa funcionando nas frases da tabela 2.3 no seu Echo.

---

## 6. Riscos

| Risco | Efeito | Plano B |
|---|---|---|
| Regras da Amazon mudarem (Alexa+ substituindo skills) | Skill precisa de ajustes | Desenho já separa skill e relay; quando o MCP da Alexa+ abrir, usar o servidor MCP do Nimbo |
| Notificação proativa limitada demais | Aviso fraco no Echo | Voice Monkey opcional (D3) ou Home Assistant |
| Limite de ~8 s da Alexa | Pedidos longos cortados | Resposta curta + notificação depois |
| Relay fora do ar | Alexa não alcança o PC | Mensagem clara na Alexa; reconexão automática no PC |
| Privacidade (outras pessoas da casa falando) | Ações indevidas | PIN e opções desligadas por padrão para o que é sensível |
| Certificação demorar (D1-b) | Atraso na loja | Lançar a 1.0 com a skill em desenvolvimento e publicar na 1.0.x |

---

## 7. O que você vai precisar fazer (eu não posso por você)

- Criar uma conta grátis de desenvolvedor Amazon (developer.amazon.com) com a mesma conta da Alexa do seu Echo.
- Criar uma conta grátis na Cloudflare.
- Se D3 = Voice Monkey: criar a conta lá e colar a chave no Nimbo.
- Se D1-b: aprovar os textos da loja e a política de privacidade antes de enviar.
- Ligar no Windows o que for necessário (reconhecimento de fala online, gravação do Game Bar). O Nimbo abre a página certa.
