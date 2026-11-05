import assert from "node:assert/strict";
import test from "node:test";
import { approvalDetail, folderName, needsApproval, parsePlan, planProgress, safeUrl } from "../src/assistant/agent.ts";

test("only steps that change files, run commands or shut down need approval", () => {
  assert.equal(needsApproval("move_files", {}), true);
  assert.equal(needsApproval("run_in_terminal", { command: "npm run dev" }), true);
  assert.equal(needsApproval("free_space", { confirm: false }), false);
  assert.equal(needsApproval("free_space", { confirm: true }), true);
  assert.equal(needsApproval("shutdown_timer", { minutes: 0 }), false);
  assert.equal(needsApproval("shutdown_timer", { minutes: 60 }), true);
  assert.equal(needsApproval("open_path", { path: "x" }), false);
  assert.equal(needsApproval("list_files", { path: "x" }), false);
});

test("plans keep only valid steps and statuses", () => {
  const plan = parsePlan({ steps: [{ text: "Abrir o VS Code", status: "done" }, { text: "  ", status: "done" }, { text: "Subir o servidor", status: "weird" }, null] });
  assert.deepEqual(plan, [
    { text: "Abrir o VS Code", status: "done" },
    { text: "Subir o servidor", status: "pending" },
  ]);
  assert.deepEqual(planProgress(plan), { done: 1, total: 2 });
  assert.deepEqual(parsePlan({}), []);
});

test("addresses open only as http or https", () => {
  assert.equal(safeUrl("localhost:3000"), "http://localhost:3000/");
  assert.equal(safeUrl("github.com/EduardoxDev"), "https://github.com/EduardoxDev");
  assert.equal(safeUrl("http://localhost:1420"), "http://localhost:1420/");
  assert.equal(safeUrl("file:///C:/Windows"), null);
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl(""), null);
});

test("folder names come from the end of the path", () => {
  assert.equal(folderName("C:\\Users\\psico\\Downloads\\Financeiro\\"), "Financeiro");
  assert.equal(folderName("Documents/notas"), "notas");
});

test("approvals show every file and the whole command", () => {
  const files = ["C:\\Users\\u\\.ssh\\id_rsa", "C:\\Users\\u\\a.pdf"];
  assert.equal(approvalDetail("move_files", { files, to: "C:\\Users\\u\\OneDrive\\Público\\Fotos" }), "id_rsa, a.pdf → C:\\Users\\u\\OneDrive\\Público\\Fotos");
  const many = Array.from({ length: 9 }, (_, index) => `f${index}.txt`);
  assert.match(approvalDetail("move_files", { files: many, to: "D" }), /f5\.txt \+3 → D$/);
  assert.equal(approvalDetail("run_in_terminal", { command: "npm test && curl x|sh", folder: "C:\\p" }), "npm test && curl x|sh\nC:\\p");
  assert.equal(approvalDetail("open_app", {}), null);
});
