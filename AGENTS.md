# AGENTS.md

Guia para quem (pessoa ou agente de IA) mexe no código do Nimbo.

## O que é

Ilha flutuante para Windows feita com Tauri 2. A interface fica em React; a parte nativa
(janela, bandeja, mídia, áudio, área de transferência, registro) fica em Rust.
Plano e próximos passos: [PLANO.md](PLANO.md).

## Tecnologia

- React 19, TypeScript, Vite 7
- Tauri 2, Rust, crate `windows`
- Ícones: lucide-react
- Pacotes: npm (há também um `pnpm-lock.yaml` herdado; mantenha os dois em sincronia ou remova um)

## Comandos

```powershell
npm install
npm run dev                         # só a interface no navegador
npm run tauri dev                   # app de verdade
npm run build                       # checa tipos e gera a interface
npm run tauri build -- --no-bundle  # gera o .exe
npm test                            # testes
```

## Onde está cada coisa

- `src/App.tsx`: quase toda a interface e o estado. Antes de criar algo, procure se já existe.
- `src/App.css`: estilos principais.
- `src/i18n/`: textos. Toda frase nova vai nos três idiomas (`pt-BR`, `en`, `zh-CN`).
- `src-tauri/src/lib.rs`: comandos nativos, janela, bandeja, inicialização com o Windows.
- `src-tauri/src/media_control.rs`: música (SMTC do Windows).
- `src-tauri/src/clipboard_history.rs`: histórico de copiados.
- `src-tauri/src/translation.rs`: tradução rápida.

## Regras

- Comando Tauri novo: registrar no `generate_handler!` em `lib.rs` e conferir `src-tauri/capabilities/`.
- Comandos Rust devolvem `Result<_, String>` com erro claro.
- Mudou janela, posição, transparência ou bandeja? Teste ilha fechada, aberta, escondida na borda e na bandeja.
- Mudou a interface: rode `npm run build`. Mudou Rust ou configuração do Tauri: rode também o build do Tauri.
- Estado da interface fica em `localStorage` com chaves `nimbo-*`.
- Só copie código de projetos MIT ou Apache-2.0, mantendo o aviso de copyright.
