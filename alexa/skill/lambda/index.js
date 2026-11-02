const Alexa = require("ask-sdk-core");
const { S3PersistenceAdapter } = require("ask-sdk-s3-persistence-adapter");
const https = require("https");
const { answer, needsPc, HELP, NOT_CONNECTED, PC_OFFLINE } = require("./nimbo");
const { codeFromSpeech } = require("./code");
const config = require("./config");

function request(method, path, body, headers = {}) {
  const url = new URL(path, config.RELAY_URL);
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve) => {
    const outgoing = https.request(
      url,
      { method, timeout: 5_000, headers: { "content-type": "application/json", ...(data ? { "content-length": Buffer.byteLength(data) } : {}), ...headers } },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: response.statusCode || 0, json });
        });
      },
    );
    outgoing.on("timeout", () => outgoing.destroy());
    outgoing.on("error", () => resolve({ status: 0, json: null }));
    if (data) outgoing.write(data);
    outgoing.end();
  });
}

const roomPath = (link, tail) => `/v1/rooms/${link.room}/${tail}?key=${link.key}`;

async function linkOf(input) {
  const attributes = await input.attributesManager.getPersistentAttributes();
  return attributes && attributes.room && attributes.key ? { room: attributes.room, key: attributes.key } : null;
}

const LaunchHandler = {
  canHandle: (input) => Alexa.getRequestType(input.requestEnvelope) === "LaunchRequest",
  async handle(input) {
    const link = await linkOf(input);
    const speech = link ? "Oi! O que você quer no computador?" : `Oi, eu sou o Nimbo. ${NOT_CONNECTED}`;
    return input.responseBuilder.speak(speech).reprompt(link ? HELP : NOT_CONNECTED).getResponse();
  },
};

const ConnectHandler = {
  canHandle: (input) => Alexa.getRequestType(input.requestEnvelope) === "IntentRequest" && Alexa.getIntentName(input.requestEnvelope) === "ConnectIntent",
  async handle(input) {
    const code = codeFromSpeech(Alexa.getSlotValue(input.requestEnvelope, "code"));
    if (!code) return input.responseBuilder.speak("Qual é o código de seis números que aparece no Nimbo?").reprompt("Diga o código de seis números.").getResponse();
    const result = await request("POST", "/v1/alexa/pair", { code }, { "x-nimbo-skill": config.SKILL_SECRET });
    if (result.status !== 200 || !result.json || !result.json.room) {
      return input.responseBuilder.speak("Esse código não funcionou. Ele vale dez minutos e só uma vez. Gere outro no Nimbo e tente de novo.").getResponse();
    }
    input.attributesManager.setPersistentAttributes({ room: result.json.room, key: result.json.key, pairedAt: Date.now() });
    await input.attributesManager.savePersistentAttributes();
    return input.responseBuilder.speak("Pronto, conectei ao seu computador! Experimente: pede pro Nimbo começar um foco.").getResponse();
  },
};

const DisconnectHandler = {
  canHandle: (input) => Alexa.getRequestType(input.requestEnvelope) === "IntentRequest" && Alexa.getIntentName(input.requestEnvelope) === "DisconnectIntent",
  async handle(input) {
    input.attributesManager.setPersistentAttributes({});
    await input.attributesManager.savePersistentAttributes();
    return input.responseBuilder.speak("Desconectei do seu computador.").getResponse();
  },
};

const PcHandler = {
  canHandle: (input) => Alexa.getRequestType(input.requestEnvelope) === "IntentRequest" && needsPc(Alexa.getIntentName(input.requestEnvelope)),
  async handle(input) {
    const link = await linkOf(input);
    if (!link) return input.responseBuilder.speak(NOT_CONNECTED).getResponse();
    const intent = Alexa.getIntentName(input.requestEnvelope);
    const slots = input.requestEnvelope.request.intent.slots || {};
    const state = await request("GET", roomPath(link, "status"));
    if (state.status === 403 || state.status === 404) {
      return input.responseBuilder.speak("Perdi a conexão com o seu computador. Gere um código novo no Nimbo e conecte de novo.").getResponse();
    }
    if (!state.json || !state.json.pcOnline) return input.responseBuilder.speak(PC_OFFLINE).getResponse();
    const reply = answer(intent, slots, state.json.status || {});
    if (reply.command) {
      const sent = await request("POST", roomPath(link, "command"), reply.command);
      if (sent.status === 409) return input.responseBuilder.speak(PC_OFFLINE).getResponse();
      if (sent.status !== 200) return input.responseBuilder.speak("O computador não aceitou o pedido agora.").getResponse();
    }
    const builder = input.responseBuilder.speak(reply.speech);
    return (reply.keepOpen ? builder.reprompt(reply.speech) : builder).getResponse();
  },
};

const HelpHandler = {
  canHandle: (input) => Alexa.getRequestType(input.requestEnvelope) === "IntentRequest" && Alexa.getIntentName(input.requestEnvelope) === "AMAZON.HelpIntent",
  handle: (input) => input.responseBuilder.speak(HELP).reprompt(HELP).getResponse(),
};

const StopHandler = {
  canHandle: (input) =>
    Alexa.getRequestType(input.requestEnvelope) === "IntentRequest" &&
    ["AMAZON.CancelIntent", "AMAZON.StopIntent", "AMAZON.NavigateHomeIntent"].includes(Alexa.getIntentName(input.requestEnvelope)),
  handle: (input) => input.responseBuilder.speak("Até mais!").getResponse(),
};

const FallbackHandler = {
  canHandle: (input) => Alexa.getRequestType(input.requestEnvelope) === "IntentRequest" && Alexa.getIntentName(input.requestEnvelope) === "AMAZON.FallbackIntent",
  handle: (input) => input.responseBuilder.speak(`Não entendi. ${HELP}`).reprompt(HELP).getResponse(),
};

const SessionEndedHandler = {
  canHandle: (input) => Alexa.getRequestType(input.requestEnvelope) === "SessionEndedRequest",
  handle: (input) => input.responseBuilder.getResponse(),
};

const ErrorHandler = {
  canHandle: () => true,
  handle: (input, error) => {
    console.log(`Erro: ${error && error.message}`);
    return input.responseBuilder.speak("Tive um problema agora. Tente de novo em instantes.").getResponse();
  },
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(LaunchHandler, ConnectHandler, DisconnectHandler, PcHandler, HelpHandler, StopHandler, FallbackHandler, SessionEndedHandler)
  .addErrorHandlers(ErrorHandler)
  .withPersistenceAdapter(new S3PersistenceAdapter({ bucketName: process.env.S3_PERSISTENCE_BUCKET }))
  .lambda();
