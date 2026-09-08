const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync(require.resolve("../src/main.js"), "utf8");

test("scene folders keep references, work and final separate", () => {
  assert.match(source, /"Scener"/);
  assert.match(source, /"Referencer"/);
  assert.match(source, /"Work"/);
  assert.match(source, /"Final"/);
});

test("Higgsfield downloads are routed to the active scene work folder", () => {
  assert.match(source, /will-download/);
  assert.match(source, /sceneWorkDir\(scene\)/);
});

test("continuity library includes characters and locations", () => {
  assert.match(source, /"Karakterer"/);
  assert.match(source, /"Locations"/);
});
