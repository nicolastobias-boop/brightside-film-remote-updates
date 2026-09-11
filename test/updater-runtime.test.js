const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness(tag, choice=1) {
 const messages=[],dialogs=[]; const parent={isDestroyed:()=>false};
 const electron={app:{isPackaged:true,getVersion:()=> '0.7.2'},dialog:{showMessageBox:async(...args)=>{dialogs.push(args);return {response:choice};}}};
 const context={module:{exports:{}},require:n=>n==='electron'?electron:require(n),AbortSignal,
  fetch:async()=>({ok:true,json:async()=>({tag_name:tag,assets:[]})}),setTimeout:()=>1,setInterval:()=>2,clearTimeout(){},clearInterval(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/updater'),'utf8'),context);
 return {messages,dialogs,parent,check:context.module.exports.setupUpdater({getSettings:()=>({autoUpdate:false}),getWindow:()=>parent,notify:m=>messages.push(m)})};
}
test('manual current-version check shows visible parented dialog',async()=>{const h=harness('v0.7.2');await h.check();assert.equal(h.dialogs[0][0],h.parent);assert.match(h.messages.at(-1),/0.7.2/);});
test('postponing an update releases busy status and allows another check',async()=>{const h=harness('v0.8.0');await h.check();assert.match(h.messages.at(-1),/udsat/);await h.check();assert.equal(h.dialogs.length,2);});
test('missing release assets produces a visible error without installing',async()=>{const h=harness('v0.8.0',0);await h.check();assert.equal(h.dialogs.at(-1)[1].type,'error');assert.match(h.messages.at(-1),/mangler Mac-pakke/);});
