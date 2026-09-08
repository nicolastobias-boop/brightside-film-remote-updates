const $ = selector => document.querySelector(selector);
const messages = $("#messages");
let mediaRecorder;
let chunks = [];
let appState;

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

async function initialize() {
  appState = await window.brightside.getState();
  $("#model").value = appState.model || "gpt-5.6-terra";
  $("#autoUpdate").checked = appState.autoUpdate !== false;
  renderImports(appState.imports || []);
  renderWorkflows(appState.workflows || []);
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
window.brightside.onUpdateStatus(message=>{$("#updateStatus").textContent=message;});
$("#importBtn").onclick=async()=>renderImports(await window.brightside.importProjectFiles());
$("#openProjectFolderBtn").onclick=()=>window.brightside.openProjectFolder();
$("#imageForm").addEventListener("submit",async event=>{
  event.preventDefault(); const brief=$("#imageBrief").value.trim(); if(!brief)return;
  $("#createImageBtn").disabled=true; $("#imageStatus").textContent="Bygger filmisk prompt og skaber reference…";
  try{
    const result=await window.brightside.createImage({brief,kind:$("#imageKind").value,ratio:$("#imageRatio").value,quality:$("#imageQuality").value,useReferences:$("#useReferences").checked});
    const card=document.createElement("article"); card.className="imageResult"; const img=document.createElement("img"); img.src=result.dataUrl; img.alt=result.name; const p=document.createElement("p"); p.textContent="Tilføjet til Kessler-profilen"; card.append(img,p); $("#imageResults").prepend(card);
    appState=await window.brightside.getState(); renderImports(appState.imports||[]); $("#imageStatus").textContent="Referencebilledet er klar og gemt i den lokale Kessler-mastermappe.";
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

initialize();
