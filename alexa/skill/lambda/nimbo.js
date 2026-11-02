const crypto = require("crypto");

const NEEDS_PC = new Set([
  "FocusStartIntent",
  "FocusPauseIntent",
  "FocusStatusIntent",
  "WaterAddIntent",
  "WaterStatusIntent",
  "TaskAddIntent",
  "TasksListIntent",
  "PlayPauseIntent",
  "NextIntent",
  "PreviousIntent",
  "NowPlayingIntent",
  "LockIntent",
  "AgendaIntent",
  "StatusIntent",
  "ApprovalStatusIntent",
  "ApproveIntent",
  "DenyIntent",
]);

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function listOf(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

function minutesLeft(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  return minutes <= 1 ? "menos de um minuto" : `${minutes} minutos`;
}

function pinHash(pin) {
  return crypto.createHash("sha256").update(`nimbo-pin:${pin}`).digest("hex");
}

function needsPc(intent) {
  return NEEDS_PC.has(intent);
}

function slot(slots, name) {
  const value = slots && slots[name] && slots[name].value;
  return typeof value === "string" ? value.trim() : "";
}

function answer(intent, slots, status) {
  const focus = status && status.focus;
  const water = status && status.water;
  const music = status && status.music;
  const tasks = (status && status.tasks) || [];
  const approval = status && status.approval;

  switch (intent) {
    case "FocusStartIntent":
      if (focus && focus.status === "running") return { speech: `O foco já está rodando. Faltam ${minutesLeft(focus.remainingMs)}.` };
      return { speech: "Comecei o foco. Bom trabalho!", command: { action: "focus_start" } };
    case "FocusPauseIntent":
      if (!focus || focus.status !== "running") return { speech: "Não tem foco rodando agora." };
      return { speech: "Pausei o foco.", command: { action: "focus_pause" } };
    case "FocusStatusIntent":
      if (!focus || focus.status === "idle") return { speech: "Nenhum foco agora. Quer que eu comece um? Diga: começar um foco." };
      if (focus.status === "paused") return { speech: `O foco está pausado, com ${minutesLeft(focus.remainingMs)} restantes.` };
      return { speech: `${focus.phase === "focus" ? "Foco" : "Pausa"}: faltam ${minutesLeft(focus.remainingMs)}.` };
    case "WaterAddIntent": {
      if (!water) return { speech: "Anotei um copo de água.", command: { action: "water_add" } };
      return { speech: "Anotei um copo de água. Boa!", command: { action: "water_add" } };
    }
    case "WaterStatusIntent": {
      if (!water || !water.goalMl) return { speech: "Não sei sua meta de água ainda. Configure no Nimbo." };
      const percent = Math.min(100, Math.round((water.drankMl / water.goalMl) * 100));
      const left = Math.max(0, water.goalMl - water.drankMl);
      return {
        speech:
          left === 0
            ? `Você já bateu a meta: ${water.drankMl} mililitros hoje!`
            : `Você bebeu ${water.drankMl} mililitros, ${percent} por cento da meta. Faltam ${left}.`,
      };
    }
    case "TaskAddIntent": {
      const title = slot(slots, "task");
      if (!title) return { speech: "Qual tarefa? Diga, por exemplo: anotar comprar pão.", keepOpen: true };
      return { speech: `Anotei: ${title}.`, command: { action: "task_add", value: title.slice(0, 200) } };
    }
    case "TasksListIntent": {
      const open = tasks.filter((task) => !task.completed).map((task) => task.title);
      if (open.length === 0) return { speech: "Nenhuma tarefa pendente. Dia livre!" };
      const first = open.slice(0, 5);
      const more = open.length > first.length ? ` E mais ${open.length - first.length}.` : "";
      return { speech: `Você tem ${plural(open.length, "tarefa", "tarefas")}: ${listOf(first)}.${more}` };
    }
    case "PlayPauseIntent":
      if (!music) return { speech: "Não tem nada tocando no computador." };
      return { speech: music.playing ? "Pausei a música." : "Voltei a tocar.", command: { action: "play_pause" } };
    case "NextIntent":
      return { speech: "Próxima.", command: { action: "next" } };
    case "PreviousIntent":
      return { speech: "Voltei uma.", command: { action: "previous" } };
    case "NowPlayingIntent":
      if (!music || !music.title) return { speech: "Nada tocando no computador agora." };
      return { speech: `${music.playing ? "Tocando" : "Pausado"}: ${music.title}${music.artist ? `, de ${music.artist}` : ""}.` };
    case "LockIntent":
      return { speech: "Bloqueei o computador.", command: { action: "lock" } };
    case "AgendaIntent": {
      const agenda = (status && status.agenda) || [];
      if (agenda.length === 0) return { speech: "Nada mais na agenda hoje." };
      const items = agenda.slice(0, 4).map((event) => (event.allDay ? `${event.title}, o dia todo` : `${event.title} às ${event.time}`));
      return { speech: `Hoje você tem: ${listOf(items)}.` };
    }
    case "StatusIntent": {
      const parts = [];
      if (focus && focus.status === "running") parts.push(`foco rodando, faltam ${minutesLeft(focus.remainingMs)}`);
      if (music && music.playing && music.title) parts.push(`tocando ${music.title}`);
      if (water && water.goalMl) parts.push(`${Math.min(100, Math.round((water.drankMl / water.goalMl) * 100))} por cento da água`);
      const open = tasks.filter((task) => !task.completed).length;
      if (open > 0) parts.push(plural(open, "tarefa pendente", "tarefas pendentes"));
      if (approval) parts.push(`${approval.agent} esperando sua aprovação`);
      if (parts.length === 0) return { speech: "Tudo tranquilo no computador." };
      return { speech: `No computador: ${listOf(parts)}.` };
    }
    case "ApprovalStatusIntent":
      if (!approval) return { speech: "Nenhum pedido esperando você." };
      return { speech: `${approval.agent} pede: ${approval.question}. Para aprovar, diga: aprovar com o código, e o seu PIN.`, keepOpen: true };
    case "ApproveIntent": {
      if (!approval) return { speech: "Nenhum pedido esperando você." };
      if (!status.alexaPinHash) return { speech: "Aprovar pela Alexa está desligado. Ligue no Nimbo, em Configurações, Alexa." };
      const pin = slot(slots, "pin");
      if (!pin) return { speech: "Qual é o seu PIN?", keepOpen: true };
      if (pinHash(pin) !== status.alexaPinHash) return { speech: "PIN errado. Não aprovei." };
      return { speech: "Aprovado.", command: { action: "approve", value: approval.id } };
    }
    case "DenyIntent":
      if (!approval) return { speech: "Nenhum pedido esperando você." };
      return { speech: "Recusei o pedido.", command: { action: "deny", value: approval.id } };
    default:
      return { speech: "Não entendi. Diga ajuda para ouvir o que eu sei fazer.", keepOpen: true };
  }
}

const HELP =
  "Eu controlo o Nimbo no seu computador. Você pode dizer: começar um foco, quanto falta do foco, eu bebi água, anotar uma tarefa, quais são minhas tarefas, pausar a música, o que eu tenho hoje, ou bloquear o computador.";

const NOT_CONNECTED =
  "Ainda não conectei ao seu computador. No Nimbo, abra Configurações, Celular, e toque em Conectar à Alexa. Depois me diga o código de seis números.";

const PC_OFFLINE = "Seu computador parece desligado ou sem internet. Tente de novo quando ele estiver ligado.";

module.exports = { answer, needsPc, pinHash, HELP, NOT_CONNECTED, PC_OFFLINE };
