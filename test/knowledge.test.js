const test = require("node:test");
const assert = require("node:assert/strict");
const { KESSLER_PROFILE, HIGGSFIELD_WORKFLOWS, buildSystemPrompt } = require("../src/knowledge");

test("Kessler profile contains continuity and exclusions", () => {
  assert.equal(KESSLER_PROFILE.id, "kessler");
  assert.ok(Array.isArray(KESSLER_PROFILE.characters));
  assert.ok(KESSLER_PROFILE.immutableCore.exclusions.length >= 1);
});

test("system prompt carries project and imported knowledge", () => {
  const prompt = buildSystemPrompt(KESSLER_PROFILE, "Lookbook: wet asphalt");
  assert.match(prompt, /credit_spend/);
  assert.match(prompt, /wet asphalt/);
  assert.match(prompt, /CinemaScope/);
});

test("workflow map covers image, cinema, edit, motion and reframe", () => {
  const ids = HIGGSFIELD_WORKFLOWS.map(item => item.id);
  for (const id of ["reference", "image", "seedance25", "seedance20", "cinema", "edit", "motion", "reframe", "genjutsu", "supercomputer"]) assert.ok(ids.includes(id));
});

test("Kessler is locked to CinemaScope and includes current engine choices", () => {
  assert.match(JSON.stringify(KESSLER_PROFILE), /2\.39:1/);
  const ids = HIGGSFIELD_WORKFLOWS.map(item => item.id);
  assert.ok(ids.includes("supercomputer"));
  assert.ok(ids.includes("seedance25"));
  assert.ok(ids.includes("seedance20"));
  assert.ok(ids.includes("genjutsu"));
});
