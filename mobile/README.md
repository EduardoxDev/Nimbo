# Nimbo para iPhone

A ilha do Nimbo no iPhone: o mesmo mascote e as mesmas páginas do PC (música, foco,
tarefas, água, avisos), **widgets** na tela inicial e de bloqueio, a **ilha dinâmica**
(Live Activity) com botões, e controle do PC **de qualquer lugar**.

```
iPhone (app, widgets, ilha)  ⇄  servidor no Cloudflare (relay/)  ⇄  Nimbo no PC
                  └──────── ou direto pelo Wi-Fi de casa ────────┘
```

Feito em Expo (React Native). Os widgets e a ilha são Swift (`targets/widget`,
`modules/nimbo-live`). O build do iOS roda na nuvem da Expo: **não precisa de Mac**.

## De graça (sem conta paga da Apple)

Há dois jeitos, e dá para usar os dois. Ambos usam o servidor no Cloudflare, que é grátis.

| | Web app | App completo (SideStore) |
|---|---|---|
| Quem pode usar | Qualquer pessoa | Você (cada pessoa instalaria igual) |
| Ilha, páginas e controle do PC de qualquer lugar | ✅ | ✅ |
| Avisos na tela de bloqueio | ✅ (notificações) | ✅ com o app aberto |
| Widgets e Dynamic Island | ❌ (a Apple não deixa site ter) | ✅ |
| Precisa reinstalar | Nunca | A cada 7 dias (o SideStore faz sozinho) |

### Passo 1 — servidor no ar (vale para os dois)

```powershell
cd relay
npm install
npx wrangler login          # conta grátis em dash.cloudflare.com
npm run vapid               # chaves dos avisos: siga o que aparecer na tela
npm run deploy              # monta o web app e publica tudo
```

O `deploy` mostra o endereço, como `https://nimbo-relay.SEU-NOME.workers.dev`. No Nimbo do PC:
**Configurações → Celular → App do iPhone**, cole o endereço e ligue **Usar o Nimbo de
qualquer lugar**. Aparece um QR code.

> O Expo pede Node 22 para alguns comandos; se o `npm run deploy` reclamar, instale o
> Node 22 LTS em nodejs.org.

### Jeito A — web app (qualquer pessoa)

1. No iPhone, abra a **Câmera** e aponte para o QR code. Toque no link: o Safari abre o
   Nimbo já pareado.
2. Toque em **Compartilhar → Adicionar à Tela de Início**. Pronto: o Nimbo vira um ícone e
   abre em tela cheia.
3. Abra pelo ícone, vá na página **PC** e toque em **Ativar avisos** para receber os avisos
   da ilha como notificação (iOS 16.4 ou mais novo).

### Jeito B — app completo no seu iPhone (SideStore)

1. Instale o **SideStore** seguindo sidestore.io (usa o seu Apple ID **grátis**; no Windows
   o primeiro passo é feito com o iTunes e o programa do site).
2. No GitHub do projeto: **Actions → App do iPhone (SideStore) → Run workflow**. Ele monta o
   app em um Mac do GitHub, de graça, e publica o `Nimbo.ipa` em **Releases →
   ios-sidestore**.
3. No iPhone, baixe o `Nimbo.ipa` pelo Safari e abra com o **SideStore** (ou, no SideStore,
   **+** e escolha o arquivo).
4. Abra o Nimbo, toque em **Parear com o PC** e leia o QR code. Para a ilha: página **PC →
   Mostrar na ilha do iPhone**. Para os widgets: segure a tela inicial → **+** → Nimbo.

Limites do Apple ID grátis: o app vale 7 dias (o SideStore renova sozinho com o iPhone no
Wi-Fi), no máximo 3 apps instalados assim, e a ilha do iPhone só atualiza com o app aberto
(atualizar com ele fechado precisa da conta paga).

## Com a conta paga da Apple (App Store e TestFlight)

### O que você precisa (uma vez)

1. **Conta de desenvolvedor da Apple** (US$ 99/ano): app *Apple Developer* no iPhone →
   *Inscrever-se agora* → *Individual*. Depois de aprovada, anote o **Team ID**
   (developer.apple.com → Membership).
2. **Conta na Expo** (grátis): expo.dev/signup.
3. **Conta no Cloudflare** (grátis): dash.cloudflare.com/sign-up.
4. **Node 20 ou mais novo** no PC (já tem).

### 1. Pôr o servidor no ar (5 minutos)

```powershell
cd relay
npm install
npx wrangler login
npx wrangler deploy
```

O `deploy` mostra o endereço, algo como `https://nimbo-relay.SEU-NOME.workers.dev`.

No Nimbo do PC: **Configurações → Celular → App do iPhone**, cole esse endereço e ligue
**Usar o Nimbo de qualquer lugar**. Quando aparecer "Conectado ao servidor", aparece
também o QR code de pareamento.

### 2. Ajustar o app para a sua conta

Em `mobile/app.json`:

- `ios.appleTeamId`: o seu Team ID.
- `ios.bundleIdentifier`: deixe `com.eduardoxdev.nimbo` ou troque (precisa ser único na
  Apple). Se trocar, troque também o grupo `group.com.eduardoxdev.nimbo` em `app.json`,
  `targets/widget/Shared.swift`, `modules/nimbo-live/ios/NimboCommandIntent.swift`,
  `src/useIphoneIsland.ts`, e o `APNS_BUNDLE_ID` em `relay/wrangler.toml`.

### 3. Gerar e instalar no seu iPhone

```powershell
cd mobile
npm install
npm install -g eas-cli
eas login
eas build:configure
eas device:create            # registra o seu iPhone (abre um link no celular)
eas build --platform ios --profile development
```

Quando o build terminar, abra o link no iPhone para instalar. Na primeira vez, ative
*Ajustes → Privacidade e Segurança → Modo de Desenvolvedor*.

Abra o app, toque em **Parear com o PC** e aponte para o QR code das Configurações.

### 4. A ilha atualizando com o app fechado (opcional)

Sem isto, a ilha do iPhone atualiza com o app aberto e os widgets a cada ~15 minutos.
Com isto, o servidor avisa o iPhone na hora.

1. developer.apple.com → *Certificates, IDs & Profiles* → *Keys* → **+** → marque
   *Apple Push Notifications service (APNs)* → baixe o arquivo `AuthKey_XXXX.p8`
   (só dá para baixar uma vez; guarde e **não** coloque no Git).
2. No PC:

```powershell
cd relay
npx wrangler secret put APNS_KEY       # cole o conteúdo do .p8
npx wrangler secret put APNS_KEY_ID    # o XXXX do nome do arquivo
npx wrangler secret put APNS_TEAM_ID   # o seu Team ID
npx wrangler deploy
```

Builds de desenvolvimento usam `APNS_SANDBOX = "1"` (em `relay/wrangler.toml`); para
TestFlight e App Store, mude para `"0"` e rode `npx wrangler deploy` de novo.

### 5. Outras pessoas usarem

Cada pessoa usa o Nimbo no PC dela e pareia o próprio iPhone. Para distribuir:

```powershell
eas build --platform ios --profile production
eas submit --platform ios
```

Isso manda para o **TestFlight** (até 10 mil testadores por link) e, depois da revisão
da Apple, para a **App Store**. Cada PC cria a própria sala com código próprio no
servidor; um servidor serve muita gente no plano grátis do Cloudflare.

## Rodar sem iPhone (pré-visualização)

```powershell
cd mobile
npx expo start --web
```

Abre no navegador com a ilha e as páginas (widgets e ilha dinâmica só existem no iPhone).

## Privacidade

- O servidor é seu (sua conta Cloudflare). Ele guarda só o último estado da ilha e a capa
  da música de cada sala, para os widgets.
- Só entra na sala quem tem o código do QR; o servidor guarda o código embaralhado
  (hash). **Novo código** no PC desconecta todos os celulares pareados antes.
- Sem o servidor, o app funciona pelo Wi-Fi de casa, direto com o PC.
