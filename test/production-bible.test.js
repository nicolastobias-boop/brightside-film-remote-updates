const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {ENGINE_CATALOG,normalizeBible,readiness,buildBibleText} = require("../src/production-bible");

test("Production Bible normalizes old state without losing scenes", () => {
  const state={scenes:[{id:"s1",title:"Scene 1"}],activeSceneId:"s1"};
  normalizeBible(state);
  assert.equal(state.scenes.length,1);
  assert.deepEqual(state.shots,[]);
  assert.deepEqual(state.sceneBindings,[]);
});

test("Production Bible is locked to KESSLER format and reports readiness", () => {
  const state={scenes:[{id:"s1",title:"Ringen"}],activeSceneId:"s1",projectMeta:{},styleLocks:{visualStyle:"rå",cameraLens:"35mm",characterContinuity:"Mikkel",locationLighting:"overhead"},shots:[{sceneId:"s1",code:"SH001",title:"Indgang",engine:"seedance25",status:"planlagt",prompt:"Walks in"}]};
  const result=readiness(state),text=buildBibleText(state);
  assert.equal(result.ready,6);
  assert.match(text,/CinemaScope 2\.39:1/);
  assert.match(text,/25 fps/);
  assert.match(text,/SH001/);
});

test("Engine Center includes dedicated background replacement contract", () => {
  const engine=ENGINE_CATALOG.find(item=>item.id==="background-swap");
  assert.ok(engine);
  assert.match(engine.promptOrder.join(" "),/lås forgrund/);
  assert.match(engine.promptOrder.join(" "),/bevar timing og kamera/);
});

test("every hard renderer id exists in the HTML", () => {
  const root=path.join(__dirname,"..");
  const js=fs.readFileSync(path.join(root,"src/renderer.js"),"utf8");
  const html=fs.readFileSync(path.join(root,"src/index.html"),"utf8");
  const ids=[...js.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map(match=>match[1]);
  const missing=[...new Set(ids)].filter(id=>!new RegExp(`id=["']${id}["']`).test(html));
  assert.deepEqual(missing,[]);
});

test("promotion to Final preserves Work and state writes are atomic", () => {
  const main=fs.readFileSync(path.join(__dirname,"../src/main.js"),"utf8");
  const functionBody=main.match(/function moveWorkToFinal[\s\S]*?\n}/)?.[0]||"";
  assert.match(functionBody,/copyFileSync/);
  assert.doesNotMatch(functionBody,/renameSync/);
  assert.match(main,/function atomicWriteFile/);
  assert.match(main,/\.backup/);
});
