const $ = selector => document.querySelector(selector);
const messages = $("#messages");
let mediaRecorder;
let chunks = [];
let appState;
let continuityState;
let teamState;

function addMessage(role, text) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  if (role === "assistant") {
    const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = "B"; article.appendChild(avatar);
  }
  const box = document.createElement("div"); const p = document.createElement("p"); p.textContent = text; box.appendChild(p); article.appendChild(box);
  messages.appendChild(article); messages.scrollTop = messages.scrollHeight;
}

function renderImports(items) {
  const root = $("#imports"); root.textContent = "";
  if (!items.length) { const p=document.createElement("p"); p.className="hint"; p.textContent="Tilføj PDF, manus, lookbook eller referencebilleder."; root.appendChild(p); return; }
  items.forEach(item => { const row=document.createElement("div"); row.className="importItem"; const name=document.createElement("span"); name.textContent=item.name; const remove=document.createElement("button"); remove.textContent="Fjern"; remove.onclick=async()=>renderImports(await window.brightside.removeProjectFile(item.id)); row.append(name,remove); root.appendChild(row); });
}

function switchTab(id) {
  document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab===id));
  document.querySelectorAll(".panel").forEach(x=>x.classList.toggle("active",x.id===id));
}

function renderWorkflows(items) {
  const root = $("#workflowCards"); root.textContent = "";
  items.forEach(item => {
    const card=document.createElement("article"); card.className="workflowCard";
    const top=document.createElement("div"); top.className="workflowTop";
    const title=document.createElement("div"); const h=document.createElement("h3"); h.textContent=item.name; const best=document.createElement("p"); best.textContent=item.bestFor; title.append(h,best);
    const tag=document.createElement("span"); tag.className="engineTag"; tag.textContent=item.engine; top.append(title,tag);
    const input=document.createElement("p"); input.className="workflowMeta"; input.textContent=`Input: ${item.inputs}`;
    const advice=document.createElement("p"); advice.textContent=item.advice;
    const actions=document.createElement("div"); actions.className="workflowActions";
    const ask=document.createElement("button"); ask.textContent="Få workflow-råd"; ask.onclick=()=>{switchTab("chat"); $("#prompt").value=`Hjælp mig med ${item.name}. Stil kun de spørgsmål, der mangler, og byg derefter assets og prompt i den rigtige rækkefølge.`; $("#prompt").focus();};
    const open=document.createElement("button"); open.className="open"; open.textContent=item.route==="local-image"?"Åbn Billedmager":"Åbn i Higgsfield"; open.onclick=()=>item.route==="local-image"?switchTab("imageLab"):window.brightside.navigate(item.route);
    actions.append(ask,open); card.append(top,input,advice,actions); root.appendChild(card);
  });
}



function deadlineClass(value,delivered){if(!value||delivered)return"";const diff=new Date(value).getTime()-Date.now();return diff<0?"overdue":diff<86400000?"dueSoon":"";}
function renderProduction(data){
  $("#planSummary").textContent=`${data.summary.total} elementer · ${data.summary.made} lavet · ${data.summary.approved} godkendt · ${data.summary.delivered} leveret`;
  const root=$("#productionBoard");root.textContent="";if(!data.items.length){const empty=document.createElement("section");empty.className="identityBlock";empty.innerHTML="<h3>Ingen elementer endnu</h3><p class='hint'>Importér planen eller opret det første element ovenfor.</p>";root.appendChild(empty);return;}
  data.items.forEach(item=>{const card=document.createElement("article");card.className=`planCard ${deadlineClass(item.deadline,item.delivered)}`;
    const head=document.createElement("div");head.className="row";const title=document.createElement("div");title.className="planTitle";const strong=document.createElement("strong");strong.textContent=item.title;const meta=document.createElement("span");meta.textContent=[item.scene,item.assignedTo,item.engine].filter(Boolean).join(" · ")||"Ikke fordelt";title.append(strong,meta);const deadline=document.createElement("span");deadline.className="deadline";deadline.textContent=item.deadline?`Til Allan: ${new Date(item.deadline).toLocaleString("da-DK")}`:"Ingen deadline";head.append(title,deadline);
    const checks=document.createElement("div");checks.className="planChecks";for(const [field,label] of [["made","Lavet"],["approved","Godkendt"],["delivered","Leveret til Allan"],["privateOnly","Kun hos mig"]]){const wrap=document.createElement("label");const input=document.createElement("input");input.type="checkbox";input.checked=Boolean(item[field]);input.disabled=field==="privateOnly"&&data.currentUserRole!=="admin";input.onchange=async()=>renderProduction(await window.brightside.updateProductionItem({id:item.id,field,value:input.checked}));wrap.append(input,document.createTextNode(label));checks.appendChild(wrap);}
    const foot=document.createElement("div");foot.className="row";const notes=document.createElement("p");notes.className="hint";notes.textContent=item.notes||"Ingen noter";const remove=document.createElement("button");remove.className="small";remove.textContent="Fjern";remove.disabled=data.currentUserRole!=="admin";remove.onclick=async()=>renderProduction(await window.brightside.removeProductionItem(item.id));foot.append(notes,remove);card.append(head,checks,foot);root.appendChild(card);});
}
async function refreshProduction(){renderProduction(await window.brightside.getProductionPlan());}

function renderTeam(data){
  teamState=data;$("#teamConnection").textContent=data.backendReady?"ONLINE · SYNKRONISERET":"LOKAL KØ · SUPABASE MANGLER";
  const devices=$("#deviceList");devices.textContent="";(data.devices||[]).forEach(device=>{const row=document.createElement("div");row.className="deviceRow";const info=document.createElement("div");const strong=document.createElement("strong");strong.textContent=device.name;const sub=document.createElement("span");sub.textContent=`${device.user} · ${device.role==="admin"?"Admin":"Team"} · v${device.version}`;info.append(strong,sub);const live=document.createElement("span");live.className="onlineDot";live.textContent=device.online?"Online":"Offline";row.append(info,live);devices.appendChild(row);});
  const messages=$("#teamMessages");messages.textContent="";(data.messages||[]).forEach(item=>{const article=document.createElement("article");article.className="teamMessage";const meta=document.createElement("div");meta.textContent=`${item.author} · ${new Date(item.createdAt).toLocaleString("da-DK")}`;const body=document.createElement("p");body.textContent=item.text;article.append(meta,body);if(item.attachment){const file=document.createElement("button");file.className="small";file.textContent=`📎 ${item.attachment}`;file.onclick=()=>window.brightside.openTeamAttachments();article.appendChild(file);}if(item.pendingSync){const pending=document.createElement("span");pending.className="pending";pending.textContent="Venter på teamsynk";article.appendChild(pending);}messages.appendChild(article);});messages.scrollTop=messages.scrollHeight;
}
async function refreshTeam(){renderTeam(await window.brightside.getTeam());}

async function initialize() {
  appState = await window.brightside.getState();
  if(!appState.onboardingCompleted) $("#onboardingDialog").showModal();
  $("#model").value = appState.model || "gpt-5.6-terra";
  $("#autoUpdate").checked = appState.autoUpdate !== false;
  renderImports(appState.imports || []);
  renderWorkflows(appState.workflows || []);
  await refreshContinuity();
  await refreshAiKnowledge();
  await refreshTeam();
  await refreshProduction();
}

document.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => {
  switchTab(btn.dataset.tab);
}));

document.querySelectorAll(".chips button").forEach(btn => btn.onclick = () => { $("#prompt").value = btn.textContent; $("#prompt").focus(); });

$("#composer").addEventListener("submit", async event => {
  event.preventDefault(); const text=$("#prompt").value.trim(); if(!text)return; $("#prompt").value=""; addMessage("user",text); $("#sendBtn").disabled=true;
  addMessage("assistant","Arbejder i Higgsfield…"); const placeholder=messages.lastElementChild;
  try { const answer=await window.brightside.runAssistant(text,$("#engineMode").value); placeholder.querySelector("p").textContent=answer; }
  catch(error){ placeholder.querySelector("p").textContent=`Jeg kunne ikke fortsætte: ${error.message}`; }
  finally{$("#sendBtn").disabled=false;}
});

$("#settingsBtn").onclick=()=>$("#settingsDialog").showModal();
$("#saveSettings").onclick=async event=>{event.preventDefault();await window.brightside.saveSettings({apiKey:$("#apiKey").value.trim(),model:$("#model").value.trim(),autoUpdate:$("#autoUpdate").checked});$("#apiKey").value="";$("#settingsDialog").close();};
$("#checkUpdateBtn").onclick=()=>window.brightside.checkForUpdates();
window.brightside.onUpdateStatus(message=>{
  $("#updateStatus").textContent=message;
  const button=$("#topUpdateBtn");
  button.textContent=/henter|søger/i.test(message) ? message : "↓ Hent og installer opdatering";
  button.disabled=/henter|søger/i.test(message);
});
$("#importBtn").onclick=async()=>renderImports(await window.brightside.importProjectFiles());
$("#openProjectFolderBtn").onclick=()=>window.brightside.openProjectFolder();
$("#imageForm").addEventListener("submit",async event=>{
  event.preventDefault(); const brief=$("#imageBrief").value.trim(); if(!brief)return;
  $("#createImageBtn").disabled=true; $("#imageStatus").textContent="Bygger filmisk prompt og skaber reference…";
  try{
    const result=await window.brightside.createImage({brief,kind:$("#imageKind").value,ratio:$("#imageRatio").value,quality:$("#imageQuality").value,useReferences:$("#useReferences").checked});
    const card=document.createElement("article"); card.className="imageResult"; const img=document.createElement("img"); img.src=result.dataUrl; img.alt=result.name; const p=document.createElement("p"); p.textContent="Tilføjet til Kessler-profilen"; card.append(img,p); $("#imageResults").prepend(card);
    appState=await window.brightside.getState(); renderImports(appState.imports||[]); await refreshContinuity(); $("#imageStatus").textContent="Referencebilledet er klar og gemt i den aktive Kessler-mappe.";
  }catch(error){$("#imageStatus").textContent=`Kunne ikke skabe billedet: ${error.message}`;}
  finally{$("#createImageBtn").disabled=false;}
});
$("#homeBtn").onclick=()=>window.brightside.navigate("https://higgsfield.ai/");
window.brightside.onUrl(url=>{$("#url").textContent=url.replace(/^https?:\/\//,"").slice(0,85);});
window.brightside.onApproval(({purpose,risk})=>{$("#approvalText").textContent=purpose;$("#approvalRisk").textContent=risk==="credit_spend"?"Denne handling kan bruge Higgsfield-credits.":"Denne handling har en ekstern effekt.";$("#approvalDialog").showModal();});
$("#approveBtn").onclick=()=>{$("#approvalDialog").close();window.brightside.decideApproval("once");};
$("#approveTenBtn").onclick=()=>{$("#approvalDialog").close();window.brightside.decideApproval("ten");};
$("#denyBtn").onclick=()=>{$("#approvalDialog").close();window.brightside.decideApproval("deny");};
window.brightside.onApprovalBudget(remaining=>{$("#voiceStatus").textContent=remaining?`${remaining} forudgodkendte genereringer tilbage`:"De 10 genereringer er brugt · godkend igen";});

$("#micBtn").onclick=async()=>{
  if(mediaRecorder?.state==="recording"){mediaRecorder.stop();return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true}); chunks=[]; mediaRecorder=new MediaRecorder(stream);
    mediaRecorder.ondataavailable=e=>chunks.push(e.data);
    mediaRecorder.onstop=async()=>{ $("#micBtn").classList.remove("recording"); $("#voiceStatus").textContent="Transskriberer…"; const blob=new Blob(chunks,{type:mediaRecorder.mimeType}); const text=await window.brightside.transcribe(await blob.arrayBuffer(),blob.type); $("#prompt").value=text; $("#voiceStatus").textContent=""; stream.getTracks().forEach(t=>t.stop()); };
    mediaRecorder.start(); $("#micBtn").classList.add("recording"); $("#voiceStatus").textContent="Lytter — tryk igen for at stoppe";
  }catch(error){$("#voiceStatus").textContent=`Mikrofonfejl: ${error.message}`;}
};


function assetCard(asset, selectable=false) {
  const card=document.createElement("article"); card.className="assetCard";
  if(asset.thumbnail){const img=document.createElement("img");img.src=asset.thumbnail;img.alt=asset.name;card.appendChild(img);}
  else {const placeholder=document.createElement("div");placeholder.className="assetPlaceholder";placeholder.textContent="DOK";card.appendChild(placeholder);}
  const footer=document.createElement("div");footer.className="assetFooter";
  if(selectable){const check=document.createElement("input");check.type="checkbox";check.name="continuityAsset";check.value=asset.id;footer.appendChild(check);}
  const name=document.createElement("span");name.textContent=asset.name;name.title=asset.name;footer.appendChild(name);card.appendChild(footer);
  return card;
}

function renderAssetGrid(selector, assets, selectable=false) {
  const root=$(selector); root.textContent="";
  if(!assets.length){const empty=document.createElement("p");empty.className="hint";empty.textContent="Ingen elementer endnu.";root.appendChild(empty);return;}
  assets.forEach(asset=>root.appendChild(assetCard(asset,selectable)));
}

function renderFileStack(selector, files, mode="plain") {
  const root=$(selector); root.textContent="";
  if(!files.length){const empty=document.createElement("p");empty.className="hint";empty.textContent="Mappen er tom.";root.appendChild(empty);return;}
  files.forEach(file=>{
    const row=document.createElement("div");row.className="sceneFile";
    if(file.thumbnail){const img=document.createElement("img");img.src=file.thumbnail;img.alt=file.name;row.appendChild(img);}
    const name=document.createElement("span");name.textContent=file.name;name.title=file.name;row.appendChild(name);
    if(mode==="work"){const button=document.createElement("button");button.className="small";button.textContent="Flyt til Final";button.onclick=async()=>renderContinuity(await window.brightside.moveWorkToFinal(file.name));row.appendChild(button);}
    if(mode==="final"){const button=document.createElement("button");button.className="small allanButton";button.textContent="Godkend til Allan";button.onclick=async()=>{button.disabled=true;try{renderContinuity(await window.brightside.deliverFinalToEditor(file.name));}catch(error){$("#allanStatus").textContent=error.message;}finally{button.disabled=false;}};row.appendChild(button);}
    if(mode==="work"||mode==="final"){const privacy=document.createElement("label");privacy.className="filePrivacy";const check=document.createElement("input");check.type="checkbox";check.checked=Boolean(file.privateOnly);check.disabled=continuityState?.currentUserRole!=="admin";check.onchange=async()=>renderContinuity(await window.brightside.setAssetPrivate({category:mode,filename:file.name,privateOnly:check.checked}));const label=document.createElement("span");label.textContent="Kun hos mig";privacy.append(check,label);row.appendChild(privacy);}
    root.appendChild(row);
  });
}

function renderContinuity(data) {
  continuityState=data;
  const select=$("#sceneSelect"); select.textContent="";
  const empty=document.createElement("option");empty.value="";empty.textContent=data.scenes.length ? "Vælg scene…" : "Ingen scene endnu";select.appendChild(empty);
  data.scenes.forEach(scene=>{const option=document.createElement("option");option.value=scene.id;option.textContent=scene.title;option.selected=scene.id===data.activeSceneId;select.appendChild(option);});
  const active=data.scenes.find(scene=>scene.id===data.activeSceneId);
  $("#activeScenePath").textContent=active ? `KESSLER/Scener/${active.folder}/Referencer · Work · Final` : "Opret eller vælg en scene.";
  $("#openSceneFolderBtn").disabled=!active;
  $("#importSceneRefsBtn").disabled=!active;
  $("#addElementsBtn").disabled=!active;
  renderAssetGrid("#characterAssets",data.characters||[],true);
  renderAssetGrid("#locationAssets",data.locations||[],true);
  renderAssetGrid("#sceneReferences",data.references||[],false);
  renderFileStack("#sceneWork",data.work||[],"work");
  renderFileStack("#sceneFinal",data.final||[],"final");
  const isAdmin=data.currentUserRole==="admin";$("#scenePrivate").disabled=!active||!isAdmin;$("#scenePrivate").checked=Boolean(active?.privateOnly);$("#privacyStatus").textContent=active?.privateOnly?"Privat scene · bliver kun på denne Mac":"Delt scene · klar til teamsynk";
  $("#allanFolder").textContent=data.editorDeliveryCustom?data.editorDeliveryDir:"Lokal standardmappe · vælg en delt mappe på Allans Mac";$("#allanStatus").textContent=(data.editorDeliveries||[]).length?`${data.editorDeliveries.length} masterlevering(er) · 25 fps · CinemaScope`:"Ingen mastere afleveret fra denne scene endnu.";
  const deliveryRoot=$("#allanDeliveries");deliveryRoot.textContent="";(data.editorDeliveries||[]).slice().reverse().forEach(item=>{const row=document.createElement("div");row.className="deliveryRow";const name=document.createElement("strong");name.textContent=item.masterName;const time=document.createElement("span");time.textContent=new Date(item.approvedAt).toLocaleString("da-DK");row.append(name,time);deliveryRoot.appendChild(row);});
}

async function refreshContinuity(){renderContinuity(await window.brightside.getContinuity());}

$("#newSceneForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const input=$("#newSceneName"); const title=input.value.trim(); if(!title)return;
  renderContinuity(await window.brightside.createScene({title,privateOnly:$("#newScenePrivate").checked})); input.value="";$("#newScenePrivate").checked=false;
});
$("#sceneSelect").onchange=async event=>{if(event.target.value)renderContinuity(await window.brightside.activateScene(event.target.value));};
$("#importCharactersBtn").onclick=async()=>renderContinuity(await window.brightside.importContinuity("character"));
$("#importLocationsBtn").onclick=async()=>renderContinuity(await window.brightside.importContinuity("location"));
$("#importSceneRefsBtn").onclick=async()=>renderContinuity(await window.brightside.importContinuity("scene"));
$("#addElementsBtn").onclick=async()=>{
  const ids=[...document.querySelectorAll('input[name="continuityAsset"]:checked')].map(input=>input.value);
  if(!ids.length){$("#activeScenePath").textContent="Vælg mindst én karakter eller location.";return;}
  renderContinuity(await window.brightside.addElementsToScene(ids));
};
$("#openSceneFolderBtn").onclick=()=>window.brightside.openSceneFolder();
$("#scenePrivate").onchange=async event=>renderContinuity(await window.brightside.setScenePrivate(event.target.checked));
$("#chooseAllanFolderBtn").onclick=async()=>renderContinuity(await window.brightside.chooseEditorDeliveryFolder());
$("#openAllanFolderBtn").onclick=()=>window.brightside.openEditorDeliveryFolder();
$("#topUpdateBtn").onclick=()=>window.brightside.checkForUpdates();
window.brightside.onContinuityChanged(data=>renderContinuity(data));

function sourceLabel(value){return value==="claude"?"Claude":value==="higgsfield"?"Higgsfield":"Anden AI";}

function renderAiKnowledge(items){
  const root=$("#aiKnowledgeList");root.textContent="";
  if(!items.length){const empty=document.createElement("p");empty.className="hint";empty.textContent="Der er endnu ikke importeret AI-viden.";root.appendChild(empty);return;}
  items.forEach(item=>{
    const card=document.createElement("article");card.className="knowledgeCard";
    const top=document.createElement("div");top.className="row";
    const title=document.createElement("strong");title.textContent=item.name;
    const tag=document.createElement("span");tag.className="knowledgeTag";tag.textContent=sourceLabel(item.source);
    top.append(title,tag);
    const excerpt=document.createElement("p");excerpt.textContent=item.excerpt||"Visuel reference";
    const remove=document.createElement("button");remove.className="knowledgeRemove";remove.textContent="Fjern";remove.onclick=async()=>renderAiKnowledge(await window.brightside.removeAiKnowledge(item.id));
    card.append(top,excerpt,remove);root.appendChild(card);
  });
}

async function refreshAiKnowledge(){renderAiKnowledge(await window.brightside.getAiKnowledge());}

$("#importAiBtn").onclick=async()=>{
  $("#aiKnowledgeStatus").textContent="Importerer og læser materialet…";
  try{const items=await window.brightside.importAiKnowledge($("#aiSource").value);renderAiKnowledge(items);$("#aiKnowledgeStatus").textContent="Viden er importeret og indgår nu i KESSLER-assistenten.";}
  catch(error){$("#aiKnowledgeStatus").textContent=`Importen fejlede: ${error.message}`;}
};
$("#saveAiTextBtn").onclick=async()=>{
  const text=$("#aiKnowledgeText").value.trim();
  if(!text){$("#aiKnowledgeStatus").textContent="Indsæt først samtalen eller promptloggen.";return;}
  try{
    const items=await window.brightside.saveAiKnowledgeText({sourceType:$("#aiSource").value,title:$("#aiKnowledgeTitle").value.trim(),text});
    renderAiKnowledge(items);$("#aiKnowledgeText").value="";$("#aiKnowledgeTitle").value="";
    $("#aiKnowledgeStatus").textContent="Teksten er gemt lokalt og indgår nu i projektviden.";
  }catch(error){$("#aiKnowledgeStatus").textContent=`Kunne ikke gemme: ${error.message}`;}
};

$("#onboardingLoginBtn").onclick=()=>window.brightside.navigate("https://higgsfield.ai");
$("#onboardingDoneBtn").onclick=async()=>{await window.brightside.completeOnboarding($("#onboardingName").value);$("#onboardingDialog").close();await refreshTeam();};
$("#productionForm").onsubmit=async event=>{event.preventDefault();const payload={title:$("#prodTitle").value.trim(),scene:$("#prodScene").value.trim(),assignedTo:$("#prodOwner").value.trim(),engine:$("#prodEngine").value.trim(),deadline:$("#prodDeadline").value,notes:$("#prodNotes").value.trim(),privateOnly:$("#prodPrivate").checked};renderProduction(await window.brightside.createProductionItem(payload));event.target.reset();};
$("#importPlanBtn").onclick=async()=>{try{$("#planStatus").textContent="Importerer planen…";const data=await window.brightside.importProductionPlan();renderProduction(data);$("#planStatus").textContent="Planen er importeret og gemt i KESSLER/Produktion.";}catch(error){$("#planStatus").textContent=`Importen fejlede: ${error.message}`;}};
$("#openPlanFolderBtn").onclick=()=>window.brightside.openProductionFolder();
$("#teamFab").onclick=()=>$("#teamPanel").classList.toggle("open");$("#teamClose").onclick=()=>$("#teamPanel").classList.remove("open");
$("#teamComposer").onsubmit=async event=>{event.preventDefault();const input=$("#teamInput"),value=input.value.trim();if(!value)return;input.value="";renderTeam(await window.brightside.sendTeamMessage(value));};
$("#teamAttach").onclick=async()=>renderTeam(await window.brightside.attachTeamFiles());
$("#copyTerminalBtn").onclick=async()=>{const command=`xattr -dr com.apple.quarantine "/Applications/Brightside Film Remote.app"`;await navigator.clipboard.writeText(command);$("#copyTerminalBtn").textContent="Kopieret";};
setTimeout(()=>{$("#brandSplash")?.classList.add("done");setTimeout(()=>$("#brandSplash")?.remove(),650);},1500);
initialize();
