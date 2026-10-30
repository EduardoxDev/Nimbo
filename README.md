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
- Player de música do Windows (qualquer app que apareça no controle de mídia: Spotify, YouTube no navegador…):
  capa, título, artista e álbum, barra de progresso (clique para pular), volume do sistema e
  letras sincronizadas do [LRCLIB](https://lrclib.net) (só título, artista, álbum e duração saem do PC).
- Casa: ar-condicionado (temperatura, modos), luzes, tomadas e ventiladores pelo
  [Home Assistant](https://www.home-assistant.io/). O token fica no Gerenciador de Credenciais
  do Windows e a ilha só consegue ligar, desligar e ajustar esses aparelhos.
- Ar-condicionado só de controle remoto: com um Broadlink RM4 Mini na mesma rede, o Nimbo
  fala direto com ele (sem nuvem) e usa os códigos do modelo escolhido na biblioteca SmartIR.
- Janela de configurações (bandeja > Configurações… ou engrenagem na ilha).
- Tarefas do dia, nota diária e histórico.
- Histórico de copiados com favoritos e notas.
- Tradução rápida (DeepSeek, com chave do próprio usuário).
- Idiomas: português (padrão), inglês e chinês.

## Créditos

O Nimbo começou como um fork do [fly-island](https://github.com/flyl1u/fly-island) (licença MIT),
de flyl1u e colaboradores. Removemos as integrações de QQ, WeChat e QQ Mail.

Os códigos infravermelhos de ar-condicionado vêm do [SmartIR](https://github.com/smartHomeHub/SmartIR)
(licença MIT) e são baixados só quando você escolhe o seu modelo.
