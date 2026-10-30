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
7. **Produtividade** — agenda, to-do, Pomodoro, prateleira de arquivos.
8. **Plugins e temas**.
9. **Distribuição** — instalador assinado, atualização automática.

## 5. Riscos
- Contas de fabricante (LG, Samsung) mudam API sem aviso → por isso Home Assistant primeiro.
- Windows Defender/SmartScreen avisa em app sem assinatura → certificado de código na etapa 9.
- Telas com DPI diferente e vários monitores → testar cedo.
