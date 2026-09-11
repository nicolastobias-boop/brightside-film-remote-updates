const $ = selector => document.querySelector(selector);
const messages = $("#messages");
let mediaRecorder;
let chunks = [];
let appState;
let continuityState;
let bibleState;

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

function renderWorkspace(data) {
  if (!data) return;
  appState = {...(appState || {}), workspaceRoot:data.workspaceRoot, workspaceConfigured:data.configured};
  $("#onboardingWorkspacePath").textContent = data.configured ? data.projectRoot : "Ingen mappe valgt endnu";
  $("#currentWorkspacePath").textContent = data.projectRoot;
  $("#onboardingDoneBtn").disabled = !data.configured;
}

function renderScreenplays(items) {
  const root = $("#screenplayList");
  root.textContent = "";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Der er endnu ikke uploadet et manus.";
    root.appendChild(empty);
    return;
  }
  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "screenplayItem";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = item.name;
    const meta = document.createElement("span");
    meta.textContent = (item.active ? "AKTIVT MANUS" : "ARKIVERET VERSION") + " · " + Math.max(1, Math.round(item.characters / 1000)) + "k tegn";
    info.append(name, meta);
    const remove = document.createElement("button");
    remove.className = "small";
    remove.textContent = "Fjern";
    remove.onclick = async () => renderScreenplays(await window.brightside.removeScreenplay(item.id));
    row.append(info, remove);
    root.appendChild(row);
  });
}

async function refreshScreenplays() {
  renderScreenplays(await window.brightside.getScreenplays());
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

function renderBible(data){
  bibleState=data;
  $("#bibleReadiness").textContent=`${data.readiness.ready}/${data.readiness.total} kontrolpunkter klar`;
  const checks=$("#bibleChecks");checks.textContent="";data.readiness.checks.forEach(item=>{const row=document.createElement("div");row.className=`readinessItem ${item.ready?"ready":"missing"}`;row.textContent=`${item.ready?"✓":"○"} ${item.label}`;checks.appendChild(row);});
  $("#bibleLogline").value=data.projectMeta.logline||"";$("#bibleTone").value=data.projectMeta.tone||"";$("#lockVisualStyle").value=data.styleLocks.visualStyle||"";$("#lockCameraLens").value=data.styleLocks.cameraLens||"";$("#lockCharacters").value=data.styleLocks.characterContinuity||"";$("#lockLocation").value=data.styleLocks.locationLighting||"";$("#lockExclusions").value=data.styleLocks.exclusions||"";
  $("#activeBibleScene").textContent=data.activeScene?`${data.activeScene.title}${data.activeScene.anchorFrame?` · Anchor: ${data.activeScene.anchorFrame}`:" · mangler anchor frame"}`:"Vælg en scene under Scener.";
  const engineSelect=$("#shotEngine");engineSelect.textContent="";data.engines.forEach(engine=>{const option=document.createElement("option");option.value=engine.id;option.textContent=`${engine.name} · ${engine.provider}`;engineSelect.appendChild(option);});
  const list=$("#shotList");list.textContent="";if(!data.shots.length){const empty=document.createElement("p");empty.className="hint";empty.textContent="Ingen shots i den aktive scene endnu.";list.appendChild(empty);}data.shots.forEach(shot=>{const card=document.createElement("article");card.className="shotCard";const title=document.createElement("strong");title.textContent=`${shot.code} · ${shot.title}`;const meta=document.createElement("span");meta.textContent=data.engines.find(engine=>engine.id===shot.engine)?.name||shot.engine;const status=document.createElement("select");[["planlagt","Planlagt"],["arbejder","Arbejder"],["til-godkendelse","Til godkendelse"],["godkendt","Godkendt"]].forEach(([value,label])=>{const option=document.createElement("option");option.value=value;option.textContent=label;option.selected=shot.status===value;status.appendChild(option);});status.onchange=async()=>renderBible(await window.brightside.updateShot({id:shot.id,field:"status",value:status.value}));const prompt=document.createElement("p");prompt.textContent=shot.prompt||"Ingen prompt endnu";const remove=document.createElement("button");remove.className="small";remove.textContent="Fjern";remove.onclick=async()=>renderBible(await window.brightside.removeShot(shot.id));card.append(title,meta,status,prompt,remove);list.appendChild(card);});
  const engines=$("#engineCenter");engines.textContent="";data.engines.forEach(engine=>{const card=document.createElement("article");card.className="engineMini";const top=document.createElement("div");const name=document.createElement("strong");name.textContent=engine.name;const tag=document.createElement("span");tag.textContent=engine.status==="ready"?"KLAR":"EKSTERN";top.append(name,tag);const best=document.createElement("p");best.textContent=engine.bestFor;const input=document.createElement("small");input.textContent=`Input: ${engine.inputs}`;card.append(top,best,input);if(engine.status==="external"){const open=document.createElement("button");open.className="small";open.textContent="Åbn officielt værktøj";open.onclick=()=>window.brightside.openExternalEngine(engine.id);card.appendChild(open);}engines.appendChild(card);});
}
async function refreshBible(){renderBible(await window.brightside.getProductionBible());}

let projectSetup={ready:false};
function renderProjectSetup(data){
  projectSetup=data;
  $("#projectFolderPath").textContent=data.path;
  $("#projectSetupStatus").textContent=data.ready?"✓ Projektmappen er klar. Opret eller vælg nu din scene nedenfor.":"Du skal først oprette en mappe til projektet. Jeg gør den klar med ét klik.";
  $("#setupProjectBtn").hidden=data.ready;
  $("#showProjectFolderBtn").hidden=!data.ready;
}
function requireProjectSetup(){
  if(projectSetup.ready)return true;
  switchTab("chat");
  $("#projectSetupStatus").textContent="Du skal først oprette en mappe til projektet. Klik på ‘Opret projektmappe’ her.";
  $("#setupProjectBtn").scrollIntoView({block:"center",behavior:"smooth"});$("#setupProjectBtn").focus();return false;
}
function requireSceneForReferences(){
  if(!requireProjectSetup())return false;
  if(continuityState?.activeSceneId)return true;
  switchTab("chat");
  $("#assistantSceneStatus").textContent="Hvis du vil uploade referencer, skal du først oprette eller vælge en scene. Skriv scenens navn her og klik ‘Opret scene’.";
  $("#assistantSceneName").scrollIntoView({block:"center",behavior:"smooth"});$("#assistantSceneName").focus();return false;
}
$("#setupProjectBtn").onclick=async()=>{
  const button=$("#setupProjectBtn");button.disabled=true;
  try{renderProjectSetup(await window.brightside.setupProject());$("#assistantSceneName").focus();}
  catch(error){$("#projectSetupStatus").textContent=`Mappen kunne ikke oprettes: ${error.message}. Prøv igen.`;}
  finally{button.disabled=false;}
};
$("#showProjectFolderBtn").onclick=()=>window.brightside.openProjectFolder();

async function initialize() {
  appState = await window.brightside.getState();
  renderProjectSetup(await window.brightside.getProjectSetup());
  renderWorkspace(await window.brightside.getWorkspace());
  if(!appState.onboardingCompleted || !appState.workspaceConfigured) $("#onboardingDialog").showModal();
  $("#claudeWorkspaceId").value=appState.claudeWorkspaceId||"";
  $("#claudeModel").value=appState.claudeModel||"claude-opus-5";
  $("#claudeEnabled").checked=Boolean(appState.claudeEnabled);
  $("#claudeStatus").textContent=appState.hasClaudeKey?"Nøgle gemt. Test forbindelsen for at bekræfte adgang.":"Indsæt din Claude API-nøgle her, og test forbindelsen.";
  $("#partnerStatus").textContent=appState.claudeEnabled?`${appState.model} + Claude · parløb slået til`:`${appState.model} · Claude kan tilsluttes i Indstillinger`;
  $("#model").value = appState.model || "gpt-5.6-terra";
  $("#autoUpdate").checked = appState.autoUpdate !== false;
  renderImports(appState.imports || []);
  renderWorkflows(appState.workflows || []);
  await refreshContinuity();
  await refreshAiKnowledge();
  await refreshProduction();
  await refreshBible();
  await refreshScreenplays();
}

document.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => {
  switchTab(btn.dataset.tab);
}));

document.querySelectorAll(".chips button").forEach(btn => btn.onclick = () => { $("#prompt").value = btn.textContent; $("#prompt").focus(); });

$("#composer").addEventListener("submit", async event => {
  event.preventDefault(); if(!requireProjectSetup())return; const text=$("#prompt").value.trim(); if(!text)return; $("#prompt").value=""; addMessage("user",text); $("#sendBtn").disabled=true;
  addMessage("assistant",appState.claudeEnabled?"Astra og Claude forbereder dit shot…":"Arbejder i Higgsfield…"); const placeholder=messages.lastElementChild;
  try { const answer=await window.brightside.runAssistant(text,$("#engineMode").value); placeholder.querySelector("p").textContent=answer; }
  catch(error){ placeholder.querySelector("p").textContent=`Jeg kunne ikke fortsætte: ${error.message}`; }
  finally{$("#sendBtn").disabled=false;}
});

$("#settingsBtn").onclick=()=>$("#settingsDialog").showModal();
$("#saveSettings").onclick=async event=>{
  event.preventDefault();
  try{
    await window.brightside.saveSettings({apiKey:$("#apiKey").value.trim(),model:$("#model").value.trim(),autoUpdate:$("#autoUpdate").checked,claudeApiKey:$("#claudeApiKey").value.trim(),claudeModel:$("#claudeModel").value.trim(),claudeWorkspaceId:$("#claudeWorkspaceId").value.trim(),claudeEnabled:$("#claudeEnabled").checked});
    $("#apiKey").value="";$("#claudeApiKey").value="";$("#settingsSaveStatus").textContent="";await initialize();$("#settingsDialog").close();
  }catch(error){$("#settingsSaveStatus").textContent=error.message;}
};
$("#testClaudeBtn").onclick=async()=>{
  const button=$("#testClaudeBtn");button.disabled=true;$("#claudeStatus").textContent="Tester adgang…";
  try{const result=await window.brightside.testClaude({apiKey:$("#claudeApiKey").value.trim(),model:$("#claudeModel").value.trim(),workspaceId:$("#claudeWorkspaceId").value.trim()});$("#claudeStatus").textContent=`Forbindelse OK: ${result.model}. Slå parløb til og klik Gem.`;}
  catch(error){$("#claudeStatus").textContent=error.message;}
  finally{button.disabled=false;}
};
window.brightside.onAssistantProgress(message=>{$("#partnerStatus").textContent=message;});

$("#checkUpdateBtn").onclick=()=>window.brightside.checkForUpdates();
window.brightside.onUpdateStatus(message=>{
  $("#updateStatus").textContent=message;
  const button=$("#topUpdateBtn");
  const busy=/henter|søger/i.test(message);
  button.textContent=busy ? message : `↓ ${message}`;
  button.disabled=busy;
  if(!busy)setTimeout(()=>{button.textContent="↓ Søg efter opdatering";button.disabled=false;},6500);
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
$("#homeBtn").onclick=()=>window.brightside.openHiggsfield();
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
  if(asset.binding){const tag=document.createElement("span");tag.className=`bindingTag ${asset.binding.type}`;tag.textContent=asset.binding.type==="character"?"LÅST KARAKTER":asset.binding.type==="location"?"LÅST LOCATION":asset.binding.type==="background"?"BAGGRUNDSLAG":"REFERENCE";card.appendChild(tag);}
  if(asset.category==="reference"||asset.category==="reference-image"){const anchor=document.createElement("button");anchor.className="assetAnchor";anchor.textContent=asset.isAnchor?"★ Anchor":"☆ Sæt anchor";anchor.onclick=async()=>{renderContinuity(await window.brightside.setSceneAnchor({category:asset.kind==="image"?"image":"reference",filename:asset.name}));await refreshBible();};card.appendChild(anchor);}
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
    if(mode==="work"){const button=document.createElement("button");button.className="small";button.textContent="Kopiér til Final";button.onclick=async()=>renderContinuity(await window.brightside.moveWorkToFinal(file.name));row.appendChild(button);}
    if(mode==="final"){const button=document.createElement("button");button.className="small allanButton";button.textContent="Godkend til Allan";button.onclick=async()=>{button.disabled=true;try{renderContinuity(await window.brightside.deliverFinalToEditor(file.name));}catch(error){$("#allanStatus").textContent=error.message;}finally{button.disabled=false;}};row.appendChild(button);}
    if(mode==="work"||mode==="final"){const rating=document.createElement("select");rating.className=`takeRating ${file.rating}`;[["none","Uden rating"],["red","Rød"],["yellow","Gul"],["green","Grøn"]].forEach(([value,label])=>{const option=document.createElement("option");option.value=value;option.textContent=label;option.selected=file.rating===value;rating.appendChild(option);});rating.onchange=async()=>renderContinuity(await window.brightside.rateTake({category:mode,filename:file.name,rating:rating.value}));const anchor=document.createElement("button");anchor.className="small";anchor.textContent=file.isAnchor?"★ Anchor":"☆ Anchor";anchor.onclick=async()=>{renderContinuity(await window.brightside.setSceneAnchor({category:mode,filename:file.name}));await refreshBible();};row.append(rating,anchor);}
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
  const assistantSelect=$("#assistantSceneSelect");
  assistantSelect.replaceChildren(...Array.from(select.options,option=>option.cloneNode(true)));
  assistantSelect.value=active?.id||"";
  $("#assistantSceneStatus").textContent=active?`Valgt: ${active.title}. Fortsæt med referencer eller skriv dit shot.`:"Start her: vælg en scene eller giv din nye scene et navn.";

  $("#activeScenePath").textContent=active ? `KESSLER/03-SCENER/${active.folder}/01-REFERENCER · 02-WORK · 03-FINAL` : "Opret eller vælg en scene.";
  $("#openSceneFolderBtn").disabled=!active;
  $("#importSceneRefsBtn").disabled=!active;
  $("#importBackgroundBtn").disabled=!active;
  $("#sceneUploadImagesBtn").disabled=!active;
  $("#sceneUploadFilmsBtn").disabled=!active;
  $("#uploadReferenceImagesBtn").disabled=false;
  $("#uploadReferenceFilmsBtn").disabled=false;
  $("#referenceUploadStatus").textContent=active?`Aktiv scene: ${active.title} · uploads gemmes automatisk i dens Referencer-mappe.`:"Klik på Billeder eller Film — jeg hjælper dig med at gøre scenen klar først.";
  $("#addElementsBtn").disabled=!active;
  renderAssetGrid("#characterAssets",data.characters||[],true);
  renderAssetGrid("#locationAssets",data.locations||[],true);
  renderAssetGrid("#sceneReferenceImages",data.referenceImages||[],false);
  renderFileStack("#sceneReferenceFilms",data.referenceFilms||[],"plain");
  renderAssetGrid("#sceneReferences",data.referenceDocuments||[],false);
  renderFileStack("#sceneWork",data.work||[],"work");
  renderFileStack("#sceneFinal",data.final||[],"final");
  const isAdmin=data.currentUserRole==="admin";$("#scenePrivate").disabled=!active||!isAdmin;$("#scenePrivate").checked=Boolean(active?.privateOnly);$("#privacyStatus").textContent=active?.privateOnly?"Kun hos Nicolas · markeres privat":"Lokal Nicolas-scene";
  $("#allanFolder").textContent=data.editorDeliveryCustom?data.editorDeliveryDir:"Lokal standardmappe · vælg en delt mappe på Allans Mac";$("#allanStatus").textContent=(data.editorDeliveries||[]).length?`${data.editorDeliveries.length} masterlevering(er) · 25 fps · CinemaScope`:"Ingen mastere afleveret fra denne scene endnu.";
  const deliveryRoot=$("#allanDeliveries");deliveryRoot.textContent="";(data.editorDeliveries||[]).slice().reverse().forEach(item=>{const row=document.createElement("div");row.className="deliveryRow";const name=document.createElement("strong");name.textContent=item.masterName;const time=document.createElement("span");time.textContent=new Date(item.approvedAt).toLocaleString("da-DK");row.append(name,time);deliveryRoot.appendChild(row);});
}

async function refreshContinuity(){renderContinuity(await window.brightside.getContinuity());}


$("#assistantSceneForm").addEventListener("submit",async event=>{
  event.preventDefault();
  if(!requireProjectSetup())return;
  const input=$("#assistantSceneName"), title=input.value.trim(), button=$("#assistantCreateSceneBtn");
  if(!title){input.focus();return;}
  button.disabled=true;
  try{
    renderContinuity(await window.brightside.createScene({title,...manusSelections.assistantSceneName,privateOnly:$("#assistantScenePrivate").checked}));
    input.value="";$("#assistantScenePrivate").checked=false;
    await refreshBible();
  }catch(error){$("#assistantSceneStatus").textContent=`Scenen kunne ikke oprettes: ${error.message}`;}
  finally{button.disabled=false;}
});
$("#assistantSceneSelect").onchange=async event=>{
  if(!requireProjectSetup()||!event.target.value)return;
  try{renderContinuity(await window.brightside.activateScene(event.target.value));await refreshBible();}
  catch(error){$("#assistantSceneStatus").textContent=`Scenen kunne ikke vælges: ${error.message}`;}
};
$("#focusShotBtn").onclick=()=>$("#prompt").focus();

$("#newSceneForm").addEventListener("submit",async event=>{
  event.preventDefault();
  if(!requireProjectSetup())return;
  const input=$("#newSceneName"); const title=input.value.trim(); if(!title)return;
  renderContinuity(await window.brightside.createScene({title,...manusSelections.newSceneName,privateOnly:$("#newScenePrivate").checked}));await refreshBible();input.value="";$("#newScenePrivate").checked=false;
});
$("#sceneSelect").onchange=async event=>{if(event.target.value){renderContinuity(await window.brightside.activateScene(event.target.value));await refreshBible();}};
$("#importCharactersBtn").onclick=async()=>renderContinuity(await window.brightside.importContinuity("character"));
$("#importLocationsBtn").onclick=async()=>renderContinuity(await window.brightside.importContinuity("location"));
$("#importSceneRefsBtn").onclick=async()=>renderContinuity(await window.brightside.importContinuity("scene"));
$("#importBackgroundBtn").onclick=async()=>{renderContinuity(await window.brightside.importContinuity("background"));await refreshBible();};
async function uploadSceneReference(kind){
  if(!requireSceneForReferences())return;
  const label=kind==="film"?"referencefilm":"referencebilleder";$("#referenceUploadStatus").textContent=`Vælg ${label}…`;
  try{renderContinuity(await window.brightside.importSceneReferenceMedia(kind));await refreshBible();}
  catch(error){$("#referenceUploadStatus").textContent=`Upload fejlede: ${error.message}`;}
}
$("#uploadReferenceImagesBtn").onclick=()=>uploadSceneReference("image");
$("#uploadReferenceFilmsBtn").onclick=()=>uploadSceneReference("film");
$("#sceneUploadImagesBtn").onclick=()=>uploadSceneReference("image");
$("#sceneUploadFilmsBtn").onclick=()=>uploadSceneReference("film");
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

$("#bibleForm").onsubmit=async event=>{event.preventDefault();$("#bibleStatus").textContent="Gemmer låse og opdaterer lokale Bible-filer…";try{renderBible(await window.brightside.updateProductionBible({logline:$("#bibleLogline").value,tone:$("#bibleTone").value,visualStyle:$("#lockVisualStyle").value,cameraLens:$("#lockCameraLens").value,characterContinuity:$("#lockCharacters").value,locationLighting:$("#lockLocation").value,exclusions:$("#lockExclusions").value}));$("#bibleStatus").textContent="Production Bible er gemt lokalt.";}catch(error){$("#bibleStatus").textContent=error.message;}};
$("#shotForm").onsubmit=async event=>{event.preventDefault();try{renderBible(await window.brightside.createShot({code:$("#shotCode").value,title:$("#shotTitle").value,engine:$("#shotEngine").value,prompt:$("#shotPrompt").value}));event.target.reset();}catch(error){$("#bibleStatus").textContent=error.message;}};
$("#openBibleFolderBtn").onclick=()=>window.brightside.openProductionBibleFolder();

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
$("#chooseWorkspaceBtn").onclick=async()=>{
  $("#workspaceStatus").textContent="Opretter og organiserer det lokale arkiv…";
  try{const data=await window.brightside.chooseWorkspace();renderWorkspace(data);$("#workspaceStatus").textContent=data.ok?"Arbejdsområdet er klar. Alt gemmes lokalt her.":"Vælg en mappe for at fortsætte.";}
  catch(error){$("#workspaceStatus").textContent="Kunne ikke bruge mappen: " + error.message;}
};
$("#changeWorkspaceBtn").onclick=async()=>{
  try{const data=await window.brightside.chooseWorkspace();renderWorkspace(data);}
  catch(error){$("#currentWorkspacePath").textContent="Kunne ikke skifte mappe: " + error.message;}
};
$("#onboardingDoneBtn").onclick=async()=>{try{await window.brightside.completeOnboarding("Nicolas");$("#onboardingDialog").close();}catch(error){$("#workspaceStatus").textContent=error.message;}};
$("#importScreenplayBtn").onclick=async()=>{
  $("#screenplayStatus").textContent="Kopierer manus lokalt og læser det ind i projektforståelsen…";
  try{const items=await window.brightside.importScreenplay();renderScreenplays(items);$("#screenplayStatus").textContent=items.length?"Manus er gemt lokalt og bruges nu automatisk af assistenten.":"Der blev ikke valgt en fil.";}
  catch(error){$("#screenplayStatus").textContent="Manus kunne ikke importeres: " + error.message;}
};
$("#openScreenplayFolderBtn").onclick=()=>window.brightside.openScreenplayFolder();
$("#productionForm").onsubmit=async event=>{event.preventDefault();const payload={title:$("#prodTitle").value.trim(),scene:$("#prodScene").value.trim(),assignedTo:$("#prodOwner").value.trim(),engine:$("#prodEngine").value.trim(),deadline:$("#prodDeadline").value,notes:$("#prodNotes").value.trim(),privateOnly:$("#prodPrivate").checked};renderProduction(await window.brightside.createProductionItem(payload));event.target.reset();};
$("#importPlanBtn").onclick=async()=>{try{$("#planStatus").textContent="Importerer planen…";const data=await window.brightside.importProductionPlan();renderProduction(data);$("#planStatus").textContent="Planen er importeret og gemt i KESSLER/Produktion.";}catch(error){$("#planStatus").textContent=`Importen fejlede: ${error.message}`;}};
$("#openPlanFolderBtn").onclick=()=>window.brightside.openProductionFolder();
$("#copyTerminalBtn").onclick=async()=>{const command=`xattr -dr com.apple.quarantine "/Applications/Brightside Film Remote.app"`;await navigator.clipboard.writeText(command);$("#copyTerminalBtn").textContent="Kopieret";};
setTimeout(()=>{$("#brandSplash")?.classList.add("done");setTimeout(()=>$("#brandSplash")?.remove(),650);},2500);
initialize();

let manusLoaded=false;
async function loadManus(){
  if(manusLoaded)return;
  try{const data=await window.brightside.getManus();$("#manusText").value=data.text;$("#manusStatus").textContent=`Gemmes i: ${data.path}`;manusLoaded=true;}
  catch(error){$("#manusStatus").textContent=error.message;}
}
$("[data-tab='bible']").addEventListener("click",loadManus);
$("#manusText").addEventListener("input",()=>{$("#manusStatus").textContent="Du har ændringer, der ikke er gemt.";});
$("#importManusBtn").onclick=async()=>{
  if(!requireProjectSetup())return;
  try{const data=await window.brightside.importManus();if(!data)return;$("#manusText").value=data.text;manusLoaded=true;$("#manusStatus").textContent=`${data.name} er indlæst til redigering. Klik Gem manus for at gemme det som projektets manus.`;}
  catch(error){$("#manusStatus").textContent=error.message;}
};
$("#saveManusBtn").onclick=async()=>{
  if(!requireProjectSetup())return;
  try{const data=await window.brightside.saveManus($("#manusText").value);manusLoaded=true;$("#manusStatus").textContent=`Manus gemt lokalt: ${data.path}`;await refreshProjectAnalysis();}
  catch(error){$("#manusStatus").textContent=error.message;}
};

function renderProjectAnalysis(snapshot){
  $("#analysisReport").textContent=snapshot.data?.report||"Ingen analyse endnu. Gem manus og klik Analysér hele projektet.";
  $("#analysisStatus").textContent=snapshot.busy?"Projektanalysen arbejder…":snapshot.data?(snapshot.stale?"Manus eller Bible er ændret. Opdatér analysen, så karakterviden følger med.":`Analyse gemt · ${snapshot.data.chunks} manusdele · ${new Date(snapshot.data.createdAt).toLocaleString("da-DK")}. Bruges af assistenten og Billedmager.`):"Klar, når dit manus er gemt.";
  $("#analyzeProjectBtn").disabled=snapshot.busy;
  $("#analyzeProjectBtn").textContent=snapshot.data?"Opdatér projektanalysen":"Analysér hele projektet";
}
async function refreshProjectAnalysis(){try{renderProjectAnalysis(await window.brightside.getProjectAnalysis());}catch(error){$("#analysisStatus").textContent=error.message;}}
$("[data-tab='bible']").addEventListener("click",refreshProjectAnalysis);
document.querySelectorAll(".showProjectAnalysis").forEach(button=>button.onclick=async()=>{switchTab("bible");await loadManus();await refreshProjectAnalysis();$("#analysisReport").parentElement.open=true;$("#analysisStatus").scrollIntoView({block:"center"});});
window.brightside.onAnalysisProgress(message=>{$("#analysisStatus").textContent=message;});
$("#analyzeProjectBtn").onclick=async()=>{
  if(!requireProjectSetup())return;
  const button=$("#analyzeProjectBtn");button.disabled=true;
  try{
    await window.brightside.saveManus($("#manusText").value);
    $("#manusStatus").textContent="Manus er gemt. Projektanalysen starter…";
    $("#analysisStatus").textContent="Starter gennemgang af hele manus…";
    renderProjectAnalysis(await window.brightside.runProjectAnalysis());
    $("#analysisReport").parentElement.open=true;
  }catch(error){$("#analysisStatus").textContent=error.message;}finally{button.disabled=false;}
};

const manusSelections={};
for(const id of ["assistantSceneName","newSceneName"]){
 const input=$("#"+id),box=document.createElement("div"),search=document.createElement("input"),results=document.createElement("div"),label=document.createElement("label");
 search.type="search";search.id=id+"ManusSearch";search.placeholder="Fx: Redmun og Mikkel på hotellet";label.htmlFor=search.id;label.textContent="Find scenen i manus (valgfrit)";
 const hint=document.createElement("p");hint.className="hint";hint.textContent="Beskriv scenen med dine egne ord, eller søg på nummer. Jeg søger også i dialog og handling og tåler små stavefejl. Vælg et forslag, eller skriv selv et navn.";
 box.append(label,search,results,hint);input.closest("form").prepend(box);
 let revision=0,timer;
 search.oninput=()=>{clearTimeout(timer);const request=++revision;timer=setTimeout(async()=>{
 try{const data=await window.brightside.searchManusScenes(search.value);if(request!==revision)return;results.textContent="";
 if(!data.items.length&&search.value.trim())results.textContent="Ingen match. Prøv en location, eller skriv selv et navn nedenfor.";
 data.items.forEach(item=>{const button=document.createElement("button");button.type="button";button.className="manusMatch";button.textContent=`${item.number?"Scene "+item.number+" · ":""}${item.heading}${item.inferred?" (nummer aflæst fra PDF)":""}`;button.title=item.preview;const excerpt=document.createElement("p");excerpt.className="hint";excerpt.textContent=(item.matches?.length?"Matcher: "+item.matches.join(", ")+" · ":"")+item.preview;button.onclick=()=>{input.value=`${item.number?"SC"+item.number+" · ":""}${item.heading}`;manusSelections[id]={manusSceneId:item.id,manusHash:data.hash};results.textContent="Valgt: "+button.textContent+". Manusuddraget følger med ved oprettelse.";input.focus();};results.append(button,excerpt);});
 }catch(error){if(request===revision)results.textContent=error.message;}
 },180);};
 input.addEventListener("input",()=>{delete manusSelections[id];});
 input.closest("form").addEventListener("submit",()=>{setTimeout(()=>{if(!input.value){delete manusSelections[id];results.textContent="";search.value="";}},1000);});
}
