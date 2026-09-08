const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync(require.resolve("../src/main.js"), "utf8");

test("AI knowledge import supports Claude and Higgsfield exports", () => {
  assert.match(source, /AI-viden/);
  assert.match(source, /claude/);
  assert.match(source, /higgsfield/);
  assert.match(source, /\.zip/);
});

test("imported AI knowledge is included in assistant context", () => {
  assert.match(source, /IMPORTERET AI-VIDEN FRA CLAUDE\/HIGGSFIELD\/ANDRE/);
  assert.match(source, /state\.aiKnowledge/);
});
