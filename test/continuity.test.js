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

test("active scenes accept separate reference images and films", () => {
  assert.match(source, /sceneRefImagesDir/);
  assert.match(source, /sceneRefFilmsDir/);
  assert.match(source, /"mp4","mov","m4v","mkv","webm"/);
  assert.match(source, /scene:import-reference-media/);
});

test("first-run workspace creates a clear local archive", () => {
  for (const folder of ["00-PROJEKT","01-REFERENCER","02-ELEMENTER","03-SCENER","04-RENDERINGER-USORTERET","05-LEVERINGER","06-PRODUKTION"]) {
    assert.match(source, new RegExp(folder));
  }
  assert.match(source, /workspace:choose/);
  assert.match(source, /START-HER · ARKIV-OVERSIGT\.txt/);
  assert.match(source, /unclassifiedRenderDir\(item\.getFilename\(\)\)/);
});

test("screenplays are archived and included in the assistant context", () => {
  assert.match(source, /screenplayDir/);
  assert.match(source, /screenplay:import/);
  assert.match(source, /FILMENS MANUSKRIPT/);
  assert.match(source, /"pdf","docx","fdx","txt","md"/);
});
