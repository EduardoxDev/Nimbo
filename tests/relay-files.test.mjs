import assert from "node:assert/strict";
import test from "node:test";
import { attachmentHeader, chunkCount, CHUNK, cleanFileName, KEEP_FILES, KEEP_MS, pruneFiles, validFileId } from "../relay/src/files.ts";

test("file names are safe and never empty", () => {
  assert.equal(cleanFileName(String.raw`C:\Users\eu\Relatório final.pdf`), "Relatório final.pdf");
  assert.equal(cleanFileName("../../etc/passwd"), "passwd");
  assert.equal(cleanFileName('a<b>c:"d|e?f*.txt'), "abcdef.txt");
  assert.equal(cleanFileName("...."), "arquivo");
  assert.equal(cleanFileName("x".repeat(300)).length, 120);
});

test("files are cut in pieces that fit the storage", () => {
  assert.equal(chunkCount(1), 1);
  assert.equal(chunkCount(CHUNK), 1);
  assert.equal(chunkCount(CHUNK + 1), 2);
  assert.ok(validFileId("0123456789abcdef"));
  assert.ok(!validFileId("../../x"));
});

test("old and extra files are dropped", () => {
  const now = 10 * KEEP_MS;
  const files = Array.from({ length: KEEP_FILES + 3 }, (_, index) => ({ id: String(index), at: now - index * 1000 }));
  files.push({ id: "old", at: now - KEEP_MS - 1 });
  const { keep, drop } = pruneFiles(files, now);
  assert.equal(keep.length, KEEP_FILES);
  assert.equal(keep[0].id, "0");
  assert.ok(drop.some((file) => file.id === "old"));
  assert.equal(keep.length + drop.length, files.length);
});

test("downloads keep accents in the name", () => {
  assert.equal(attachmentHeader("ação.pdf"), "attachment; filename=\"a__o.pdf\"; filename*=UTF-8''a%C3%A7%C3%A3o.pdf");
});
