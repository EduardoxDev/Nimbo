# Nimbo — plano inicial

> Nome do app: **Nimbo**. Data: 29/10/2026.

Ideia: uma "ilha" flutuante no topo da tela do Windows (como a Dynamic Island do iPhone) que vira uma
central de controle bonita: música, apps, sistema, casa inteligente (ar-condicionado, luzes),
produtividade. Tudo personalizável e com visual limpo.

---

## 1. Engenharia reversa do app de inspiração (visual, não de código)

Estudamos o app pelo que ele mostra na tela. **Não** vamos descompilar o executável dele: isso costuma
violar a licença e não precisamos — os projetos abertos da seção 2 já trazem o "como fazer" técnico.

### 1.1 A ilha aberta (player de música)
| Elemento | O que vimos | Como reproduzir |
|---|---|---|
| Forma | Retângulo com cantos bem arredondados (~28–32 px), flutuando alguns px abaixo da borda | Janela Tauri sem borda, transparente, `always on top`, `border-radius` no CSS |
| Fundo | Vidro fosco escuro com tom (tint 20%) | `window-vibrancy` (Acrylic/Mica) + camada preta com opacidade ajustável |
| Topo | Ícone de status + data + hora centralizados; barras de áudio animadas à direita | Relógio local + visualizador (níveis do áudio via WASAPI) |
| Capa | ~100 px, cantos ~12 px | Miniatura vinda do SMTC do Windows |
| Texto | Título em negrito, "Artista - Álbum" em cinza | SMTC: `Title`, `Artist`, `AlbumTitle` |
| Progresso | Barra fina, tempo decorrido à esquerda, restante (negativo) à direita | SMTC `TimelineProperties` + interpolação local a cada 250 ms |
| Controles | Letra (balão), anterior, play/pause, próximo, volume | SMTC `TryTogglePlayPause`, `TrySkipNext`…; letra via LRCLIB |
| Navegação | Setas laterais `<` `>` e pontinhos de página embaixo (ativo = traço) | Carrossel de "páginas" (música, agenda, to-do, casa…) |

### 1.2 Janela de configurações
- Barra lateral estilo macOS: ícones em quadradinhos coloridos, botão vermelho de fechar.
- Seções em cartões agrupados: alternadores (toggle), controles segmentados (`Hover | Click`,
  `Normal | Fast`) e um passo-a-passo `− 20% +`.
- Estilos de ilha: **Clássico** (colado na borda de cima) e **Flutuante** (solto, logo abaixo).
- Páginas que o app tem: Geral, Anel de status, Tela, Aparência, Música e letras, To-do, Agenda,
  Pomodoro, Água, Oração, Prateleira (arquivos), HUD e pop-ups, Sobre.

### 1.3 O que vamos fazer **além** dele
- **Casa inteligente:** ar-condicionado (liga, temperatura, modo, ventilação), luzes, tomadas, cenas.
- **Apps:** lançador rápido, troca de janela, controle de volume por app, atalhos personalizados.
- **Sistema:** brilho, Wi-Fi, Bluetooth, modo escuro, luz noturna, bateria, CPU/RAM.
- **Plugins:** qualquer pessoa cria uma "página" nova para a ilha.
- **Temas:** loja de temas (cores, fontes, formato, animação).

---

## 2. Projetos prontos que podemos aproveitar

Conferido na API do GitHub em 29/10/2026.

| Projeto | Tecnologia | Licença | Uso para nós |
|---|---|---|---|
| [flyl1u/fly-island](https://github.com/flyl1u/fly-island) | Tauri 2 + React + Rust | **MIT** | **Base recomendada.** Já tem janela-ilha, vidro (`window-vibrancy`), mídia via SMTC (`media_control.rs`), bandeja, área de transferência, to-do. 328 ★, ativo. |
| [Taxperia/windows-notch-overlay](https://github.com/Taxperia/windows-notch-overlay) | Electron + .NET | Apache-2.0 (parte) | Referência de ideias: mixer de volume, brilho DDC/CI, Bluetooth, luz noturna, Pomodoro. Mistura código do DynamicWin (licença CC-BY-SA), então só olhar. |
| [maximilian467/Developer-Island](https://github.com/maximilian467/Developer-Island) | C# WinUI 3 | MIT | Referência de agenda, foco e saúde do sistema. |
| [MoFeng2223/BrimDeck](https://github.com/MoFeng2223/BrimDeck) | C# | Apache-2.0 | Referência de música e animações. |
| [gyng/widgetsack](https://github.com/gyng/widgetsack) | Tauri + React | Apache-2.0 | **Integração Home Assistant pronta** (clima/ar, luz, ventilador, cenas). Mesma tecnologia da base. |
| [TheBoredTeam/boring.notch](https://github.com/TheBoredTeam/boring.notch) | Swift (macOS) | GPL-3.0 | Só referência de UX (prateleira, HUD). GPL "contaminaria" nosso código se copiássemos. |
| [FlorianButz/DynamicWin](https://github.com/FlorianButz/DynamicWin) | C# | CC-BY-SA-4.0 | Só referência. |
| [WinIslandProject/WinIsland](https://github.com/WinIslandProject/WinIsland) | Rust + Skia | GPL-3.0 | Só referência (sistema de plugins). |

**Regra de licença:** copiar código só de MIT / Apache-2.0 (manter o aviso de copyright).
GPL e CC-BY-SA: apenas estudar ideias.

---

## 3. Arquitetura recomendada

**Tauri 2 + React/TypeScript + Rust.** Motivos: o computador já tem Node 20 e Rust 1.99 (não tem
.NET); o app final fica leve (~10 MB, pouca RAM) comparado ao Electron; React é o que já usamos na
VaultPay; e a base `fly-island` usa exatamente isso.

```
nimbo/
  src/                 # interface React (ilha + configurações)
    island/            # a ilha: formas, animações, carrossel de páginas
    pages/             # música, agenda, to-do, casa, sistema, pomodoro...
    settings/          # janela de configurações
  src-tauri/src/
    media.rs           # SMTC: faixa atual, capa, controles
    audio.rs           # volume geral e por app (WASAPI)
    system.rs          # brilho, Wi-Fi, Bluetooth, tema, bateria
    windows_apps.rs    # lista de janelas, abrir/focar apps
    smarthome/         # Home Assistant (WebSocket), Tuya, SmartThings
    plugins.rs         # carregar plugins de terceiros
```

### Ar-condicionado e casa inteligente
Caminho principal: **Home Assistant** (API WebSocket local). Ele já conversa com quase todo
ar-condicionado (LG ThinQ, Samsung, Midea, Daikin, Gree, Tuya) e com ar antigo via controle
infravermelho (Broadlink). Nós só falamos com uma entidade `climate`.
Depois: conexão direta com Tuya e SmartThings para quem não tem Home Assistant.

---

## 4. Etapas

1. ✅ **Base** — fork do `fly-island`, renomear, limpar o que é da China (QQ, WeChat, QQ Mail).
2. **Ilha** — estilos Clássico e Flutuante, vidro com tint, abrir ao passar o mouse ou clicar.
3. ✅ **Música** — player igual ao do print + letras sincronizadas (LRCLIB).
4. ✅ **Configurações** — janela com barra lateral e cartões.
5. **Sistema** — volume por app, brilho, Wi-Fi, Bluetooth, modo escuro.
6. ✅ **Casa** — Home Assistant: ar-condicionado e luzes.
7. ✅ (parcial: foco e água) **Produtividade** — agenda, to-do, Pomodoro, prateleira de arquivos.
8. **Plugins e temas**.
9. ✅ (parcial: instalador sem assinatura) **Distribuição** — instalador assinado, atualização automática.

## 5. Riscos
- Contas de fabricante (LG, Samsung) mudam API sem aviso → por isso Home Assistant primeiro.
- Windows Defender/SmartScreen avisa em app sem assinatura → certificado de código na etapa 9.
- Telas com DPI diferente e vários monitores → testar cedo.

---

## 6. Plano de melhorias (30/10/2026)

Estado hoje: app instalado e rodando no PC do Eduardo. Já tem ilha, música com letras, configurações,
Casa (Home Assistant + Broadlink + ar 3D), Foco, Água, Prateleira, HUD, agentes (MCP) e assistente.
Tamanho: P = um dia ou menos, M = alguns dias, G = uma semana ou mais.

### Fase A — Base sólida (antes de crescer)
| # | Melhoria | Por quê | Tam. |
|---|---|---|---|
| A1 | **Iniciar com o Windows** (`tauri-plugin-autostart`), opção em Geral | Hoje a ilha some depois de reiniciar o PC | P |
| A2 | **Atualização automática** (`tauri-plugin-updater` + GitHub Releases, assinatura própria do updater, grátis) | Sem isso, cada versão nova exige baixar e instalar de novo na mão | M |
| A3 | **Tela cheia e jogos**: esconder a ilha quando um app está em tela cheia (vídeo, jogo, apresentação) | A ilha por cima de jogo/filme incomoda e pode atrapalhar cliques | P |
| A4 | **Vários monitores**: escolher o monitor, ou seguir o monitor do mouse; testar DPI 100/125/150% | Risco já anotado na seção 5 e nunca testado | M |
| A5 | **Leveza**: medir CPU/RAM parado, pausar animações e consultas quando a ilha está fechada ou oculta | App de fundo tem que ser quase invisível no Gerenciador de Tarefas | M |
| A6 | **Quebrar arquivos gigantes**: `App.tsx` (6.265 linhas), `App.css` (4.483), `lib.rs` (1.866) em módulos por página | Cada mudança fica mais lenta e arriscada; facilita plugins depois | G |
| A7 | **Registro de erros local** + botão "Copiar diagnóstico" em Sobre | Hoje, quando algo falha no PC de alguém, não há como saber o quê | P |
| A8 | **CI no GitHub Actions**: testes, `cargo clippy`, tipos e instalador a cada push | Garante que nada quebra sem perceber e já gera o instalador | M |
| A9 | **Assinatura de código** do instalador | Tira o aviso do SmartScreen; tem custo anual, fazer quando for distribuir para outras pessoas | M |

### Fase B — Terminar o que está pela metade
| # | Melhoria | Por quê | Tam. |
|---|---|---|---|
| B1 | **Agenda**: ler calendários por link ICS (Google/Outlook, sem login), próximos eventos e aviso na ilha minutos antes | Única página ainda "Em breve" | M |
| B2 | **Tradução**: trocar o DeepSeek (herdado do fly-island) pelo Claude, com a mesma chave do assistente, ou remover | Hoje exige uma segunda chave de outro provedor | P |
| B3 | **Sistema** (etapa 5): volume por app, Wi-Fi, Bluetooth, modo escuro, luz noturna, bateria, CPU/RAM | Etapa do plano original ainda não feita | G |
| B4 | **Testes ao vivo pendentes**: assistente com chave real, Broadlink quando chegar, brilho, volume pela roda do mouse | Funcionam nos testes, mas nunca foram vistos no uso real | P |
| B5 | **Primeira abertura (onboarding)**: 3 telas curtas mostrando abrir a ilha, trocar página e Configurações | Quem instala hoje não sabe o que a ilha faz | P |

### Fase C — Diferenciais (o que nenhum concorrente no Windows tem junto)
| # | Melhoria | Por quê | Tam. |
|---|---|---|---|
| C1 | **Atividades ao vivo**: download do navegador, cópia de arquivos, timer, gravação de tela, chamada no Discord/Teams | É o que mais faz a ilha parecer "viva" | G |
| C2 | **Notificações do Windows na ilha** (WhatsApp, Discord, e-mail) com resposta rápida | Pede identidade de app (pacote MSIX); pesquisar antes de prometer | G |
| C3 | **Lançador rápido**: atalho de teclado abre a ilha com busca de apps, arquivos e comandos | Substitui o menu Iniciar para quem usa teclado | M |
| C4 | **Atalhos globais configuráveis** (abrir ilha, play/pause, próxima página, ligar o ar) | Pedido comum nesse tipo de app | P |
| C5 | **Assistente com voz** (aperte e fale) e mais ações no PC: abrir app, mudar volume, criar tarefa, controlar a casa | Junta o assistente com tudo o que a ilha já controla | M |
| C6 | **Automações da Casa**: "liga o ar às 22h", "desliga ao sair do PC", cenas | O ar já é controlado; falta agendar | M |
| C7 | **Tempo (clima lá fora)** no topo da ilha e no anel de status | Informação útil que cabe no espaço livre | P |
| C8 | **Agentes**: ver o progresso em tempo real (barra), aprovar ou recusar pedido do agente pela ilha | Hoje o agente só põe a tarefa; falta a conversa de volta | M |

### Fase D — Ecossistema e lançamento
| # | Melhoria | Por quê | Tam. |
|---|---|---|---|
| D1 | **Temas**: cores, formato, fonte e animação, com exportar/importar arquivo | Personalização é o centro do produto | M |
| D2 | **Plugins**: página nova da ilha em área isolada (iframe sandbox) com permissões que o usuário aprova | Outras pessoas criam páginas sem mexer no núcleo | G |
| D3 | **Site e downloads**: landing page, GitHub Releases, changelog | Para outras pessoas acharem e instalarem | M |
| D4 | **Acessibilidade**: navegação por teclado, leitor de tela, contraste, "reduzir movimento" em tudo | Obrigatório para um app que fica sempre na tela | M |
| D5 | **Revisar inglês e chinês** com quem fala a língua | Textos foram escritos sem revisão nativa | P |

### Ordem sugerida
1. **A1 + A3** (rápidos e o uso diário melhora na hora).
2. **A2 + A8** (atualizar sem reinstalar, com testes automáticos).
3. **B1 Agenda** e **B2 Tradução** (fecha as pontas soltas).
4. **A6** (organizar o código antes das features grandes).
5. **C1 Atividades ao vivo** e **C3 Lançador** (os maiores "uau").
6. Fase D quando for abrir para outras pessoas.
