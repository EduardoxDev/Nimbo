import assert from "node:assert/strict";
import test from "node:test";
import { freshMail, gmailLink, loadMailConfig, replyTask } from "../src/mail/mail.ts";

const mail = (id, important = true, at = 1) => ({ id, threadId: `t${id}`, from: "Ana", address: "ana@x.com", subject: "Proposta", snippet: "", at, important });

test("only new mail is told, important first by default", () => {
  const items = [mail("a", true, 1), mail("b", false, 2), mail("c", true, 3)];
  const first = freshMail(items, [], { onlyImportant: true }, true);
  assert.deepEqual(first.tell, []);
  assert.deepEqual(first.seen, ["a", "b", "c"]);
  const next = freshMail([mail("d", true, 9), mail("e", false, 8), ...items], first.seen, { onlyImportant: true }, false);
  assert.deepEqual(next.tell.map((item) => item.id), ["d"]);
  assert.deepEqual(freshMail([mail("f", false)], next.seen, { onlyImportant: false }, false).tell.map((item) => item.id), ["f"]);
});

test("links, tasks and settings", () => {
  assert.equal(gmailLink("18f20"), "https://mail.google.com/mail/u/0/#inbox/18f20");
  assert.equal(gmailLink("../x"), "https://mail.google.com/mail/u/0/#inbox");
  assert.equal(replyTask(mail("a"), "Responder"), "Responder Ana: Proposta");
  assert.deepEqual(loadMailConfig({ getItem: () => null }), { onlyImportant: true });
  assert.deepEqual(loadMailConfig({ getItem: () => '{"onlyImportant":false}' }), { onlyImportant: false });
});

test("meeting requests are recognised", async () => {
  const { meetingRequestOf } = await import("../src/mail/mail.ts");
  assert.equal(meetingRequestOf("marca reunião com ana@x.com quinta 15h"), true);
  assert.equal(meetingRequestOf("Ei Nimbo, agenda uma call amanhã às 10h"), true);
  assert.equal(meetingRequestOf("cria um evento sexta 9h"), true);
  assert.equal(meetingRequestOf("schedule a meeting with bob@y.com tomorrow 3pm"), true);
  assert.equal(meetingRequestOf("toca Anitta"), false);
  assert.equal(meetingRequestOf("marcador de texto"), false);
});
