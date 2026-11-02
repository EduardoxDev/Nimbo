# Nimbo na Alexa

Com a skill **Nimbo**, você fala com o Nimbo do seu PC por qualquer Echo:

> "Alexa, pede pro Nimbo começar um foco"
> "Alexa, pergunta pro Nimbo o que eu tenho hoje"

## Como funciona

```
Echo → Amazon → skill "Nimbo" (hospedada pela Amazon) → seu relay (Cloudflare) → Nimbo no PC
```

- A skill usa o mesmo relay do app do iPhone ("De qualquer lugar"). O PC não abre porta nenhuma.
- Para ligar sua conta Alexa ao PC, o Nimbo mostra um código de 6 números. Ele vale 10 minutos e só uma vez.
- Só a sua skill troca esse código, porque ela tem um segredo que só ela e o seu relay conhecem.
- A Alexa lê o estado da ilha (foco, água, tarefas, música, agenda de hoje, pedidos de aprovação) e manda os mesmos comandos que o iPhone manda.

## 1. Atualizar o relay

Precisa ser feito uma vez, no seu Cloudflare:

```bash
cd relay
npx wrangler secret put ALEXA_SKILL_SECRET
npm run deploy
```

- No primeiro comando, cole um segredo longo, com pelo menos 24 caracteres. Ele é o mesmo que vai no `config.js` da skill.
- O `npm run deploy` também gera de novo o app web do iPhone, a partir da pasta `mobile/`.

## 2. Criar a skill (na sua conta Amazon)

1. Entre em **developer.amazon.com/alexa/console/ask** com a **mesma conta** da Alexa do seu Echo.
2. **Create Skill**:
   - nome **Nimbo**;
   - idioma **Português (BR)**;
   - modelo **Other → Custom**;
   - hospedagem **Alexa-hosted (Node.js)**;
   - modelo inicial **Start from Scratch**.
3. Aba **Build → Interaction Model → JSON Editor**: apague tudo e cole o conteúdo de `alexa/skill/skill-package/interactionModels/custom/pt-BR.json`. Clique em **Save** e depois em **Build skill**.
4. Aba **Code**: troque e crie estes arquivos dentro de `lambda/`:
   - `index.js` e `package.json`: substitua pelos desta pasta;
   - `nimbo.js` e `code.js`: crie os dois com o conteúdo desta pasta;
   - `config.js`: crie a partir de `config.example.js`, com o endereço do seu relay em `RELAY_URL` e o mesmo segredo do passo 1 em `SKILL_SECRET`.

   Clique em **Save** e depois em **Deploy**.
5. Aba **Test**: mude de "Off" para **Development**. A partir daí a skill funciona nos aparelhos da sua conta. Ela não fica pública.

## 3. Conectar ao seu PC

1. No Nimbo: **Configurações → Celular**.
   - "De qualquer lugar" precisa estar ligado e com o ponto verde.
2. Na parte **Alexa**, clique em **Conectar à Alexa**. Aparece um código, por exemplo **482 113**.
3. Fale para o Echo: **"Alexa, abre o Nimbo"** e depois **"o código é 482 113"**.
4. Ela responde "Pronto, conectei ao seu computador!".

## O que dá para falar

Comece com "Alexa, pede pro Nimbo…" ou "Alexa, pergunta pro Nimbo…".

| Você fala | O que acontece |
|---|---|
| começar um foco / pausar o foco / quanto falta do foco | Pomodoro |
| eu bebi água / quanta água eu bebi | Água |
| anotar comprar pão / quais são minhas tarefas | Tarefas |
| pausar a música / próxima música / o que está tocando | Música do PC |
| o que eu tenho hoje | Agenda de hoje |
| como está meu dia | Resumo do que está acontecendo no PC |
| bloquear o computador | Trava o Windows |
| tem algum pedido / recusar | Pedidos de aprovação dos agentes |
| aprovar com o código 4821 | Aprova, se "Aprovar pedidos do Claude pela voz" estiver ligado com esse PIN |
| desconectar | Esquece o seu PC |

## Privacidade

- **A sua voz:** quem processa é a Amazon. O Nimbo recebe só a frase já entendida.
- **O seu relay:** guarda só o último estado da ilha (como já faz para o iPhone) e o código de pareamento por até 10 minutos.
- **A skill:** guarda o número da sala e a chave do relay na conta Amazon, no armazenamento da própria skill hospedada pela Amazon.
- **O PIN:** o Nimbo guarda só um resumo (hash), nunca o número. Aprovar pela voz começa desligado.
