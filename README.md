# Nimbo

Uma ilha flutuante no topo da tela do Windows: música, tarefas, histórico de copiados e, em breve,
controle de apps, do sistema e da casa (ar-condicionado, luzes).

O plano completo está em [PLANO.md](PLANO.md).

## Instalar

Rode `npm run tauri build`. O instalador sai em
`src-tauri/target/release/bundle/nsis/Nimbo_<versão>_x64-setup.exe`. Ele instala só para o seu
usuário, sem pedir administrador.

Como o instalador ainda não é assinado, o Windows mostra o aviso do SmartScreen na primeira vez:
clique em "Mais informações" e depois em "Executar assim mesmo".

O build com instalador assina o arquivo de atualização, então precisa da chave privada:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$HOME\.tauri\nimbo-updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri build
```

## Atualizações

O Nimbo procura versão nova 30 segundos depois de abrir e a cada 6 horas, em
`https://github.com/EduardoxDev/Nimbo/releases/latest/download/latest.json`. Quando acha, a ilha
mostra o aviso com **Atualizar**; também dá para procurar em Configurações → Sobre. Cada atualização é
conferida com a chave pública que está em `src-tauri/tauri.conf.json`.

A chave privada fica em `~/.tauri/nimbo-updater.key`, fora do Git. **Guarde uma cópia**: sem ela não
dá para publicar atualizações, e trocar a chave obriga todo mundo a reinstalar na mão.

### Publicar uma versão

1. No GitHub, em Settings → Secrets and variables → Actions, crie o segredo
   `TAURI_SIGNING_PRIVATE_KEY` com o conteúdo da chave privada (só na primeira vez).
2. Suba a versão em `package.json`, `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml`.
3. Faça o commit, crie a tag e envie:

```powershell
git tag v0.2.0
git push origin main --tags
```

O fluxo `Release` do GitHub Actions gera o instalador, assina e publica a versão com o
`latest.json`. Quem já tem o Nimbo recebe a atualização sozinho.

## Rodar em desenvolvimento

Precisa de Node 20+ e Rust (stable).

```powershell
npm install
npm run tauri dev
```

Gerar o executável sem instalador:

```powershell
npm run tauri build -- --no-bundle
```

## O que já funciona

- Ilha fechada e aberta, nos estilos clássico (colada no topo) e vidro (flutuante).
- Player de música do Windows (qualquer app que apareça no controle de mídia: Spotify, YouTube no navegador…):
  capa, título, artista e álbum, barra de progresso (clique para pular), volume do sistema e
  letras sincronizadas do [LRCLIB](https://lrclib.net) (só título, artista, álbum e duração saem do PC).
- Casa: ar-condicionado (temperatura, modos), luzes, tomadas e ventiladores pelo
  [Home Assistant](https://www.home-assistant.io/). O token fica no Gerenciador de Credenciais
  do Windows e a ilha só consegue ligar, desligar e ajustar esses aparelhos.
- Ar-condicionado só de controle remoto: com um Broadlink RM4 Mini na mesma rede, o Nimbo
  fala direto com ele (sem nuvem) e usa os códigos do modelo escolhido na biblioteca SmartIR.
- Prateleira: arraste arquivos até a ilha e arraste de volta para qualquer app depois
  (guarda atalhos, não cópias; miniatura para imagens). Usa o tauri-plugin-drag (MIT/Apache).
- HUD na ilha fechada: volume, brilho do notebook e música nova; rolar o mouse sobre a ilha muda o volume.
- Assistente na ilha (Claude Opus 5.5, com a sua chave da Anthropic): converse em português e ele
  cria e conclui tarefas, liga o ar, inicia o foco, marca a água e controla a música.
- Agentes de IA (Claude Code, Codex, Claude Desktop, Cursor…): servidor MCP local onde eles
  mostram o próprio plano na ilha, avisam quando terminam e te passam tarefas. Configurações >
  Agentes de IA tem o comando pronto para conectar.
- Janela de configurações (bandeja > Configurações… ou engrenagem na ilha).
- Foco (Pomodoro) com anel de progresso, rodadas e som ao fim de cada fase.
- Água: meta do dia, copo que enche e lembretes na ilha fechada ("Bebi" / "Depois").
- Anel de status na ilha fechada mostrando o foco ou a meta de água.
- Tarefas do dia, nota diária e histórico.
- Histórico de copiados com favoritos e notas.
- Tempo: escolha a cidade em Configurações → Geral e a temperatura aparece no topo da ilha (dados do Open-Meteo).
- Agentes de IA (MCP) podem pedir aprovação: a pergunta aparece na ilha com Aprovar e Recusar (`request_approval` e `check_approval`).
- Lançador de apps (Alt+Shift+Espaço), atalhos globais configuráveis e página Sistema (bateria, CPU, memória, Wi-Fi, Bluetooth, modo escuro, volume por app).
- Automações da Casa: ligar ou desligar o ar em horários e dias escolhidos.
- Agenda: liga o Google Agenda ou o Outlook pelo link ICS secreto, mostra os próximos 7 dias e avisa na ilha antes de cada compromisso.
- Tradução rápida com o Claude Haiku (mesma chave da Anthropic do assistente): português, inglês, espanhol e chinês.
- Idiomas: português (padrão), inglês e chinês.

## Créditos

O Nimbo começou como um fork do [fly-island](https://github.com/flyl1u/fly-island) (licença MIT),
de flyl1u e colaboradores. Removemos as integrações de QQ, WeChat e QQ Mail.

Os códigos infravermelhos de ar-condicionado vêm do [SmartIR](https://github.com/smartHomeHub/SmartIR)
(licença MIT) e são baixados só quando você escolhe o seu modelo.
