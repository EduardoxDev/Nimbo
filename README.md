# Nimbo

Uma ilha flutuante no topo da tela do Windows: música, tarefas, histórico de copiados e, em breve,
controle de apps, do sistema e da casa (ar-condicionado, luzes).

O plano completo está em [PLANO.md](PLANO.md).

## Rodar

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
- Player de música do Windows (qualquer app que apareça no controle de mídia: Spotify, YouTube no navegador…).
- Tarefas do dia, nota diária e histórico.
- Histórico de copiados com favoritos e notas.
- Tradução rápida (DeepSeek, com chave do próprio usuário).
- Idiomas: português (padrão), inglês e chinês.

## Créditos

O Nimbo começou como um fork do [fly-island](https://github.com/flyl1u/fly-island) (licença MIT),
de flyl1u e colaboradores. Removemos as integrações de QQ, WeChat e QQ Mail.
