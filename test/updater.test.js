const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync(require.resolve("../src/updater.js"), "utf8");

test("updater is locked to the Brightside release repository", () => {
  assert.match(source, /nicolastobias-boop\/brightside-film-remote-updates/);
});

test("updater verifies SHA-256 before installation", () => {
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /actual !== expected/);
});

test("manual update works when automatic updates are disabled", () => {
  assert.match(source, /!settings\.autoUpdate && !manual/);
});

test("update helper keeps a recoverable previous app until install succeeds", () => {
  assert.match(source, /\.previous/);
  assert.match(source, /mv "\$BACKUP" "\$CURRENT"/);
});
