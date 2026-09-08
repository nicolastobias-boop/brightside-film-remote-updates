const { app, BrowserWindow, WebContentsView, ipcMain, dialog, safeStorage, session, nativeImage, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const { toFile } = require("openai");
const pdf = require("pdf-parse");
const { KESSLER_PROFILE, HIGGSFIELD_WORKFLOWS, buildSystemPrompt } = require("./knowledge");
const { setupUpdater, stopUpdater } = require("./updater");

let mainWindow;
let higgsView;
let pendingApproval = null;
let creditApprovalBudget = 0;
let checkForUpdates;

const statePath = () => path.join(app.getPath("userData"), "state.json");
const legacyAssetDir = () => path.join(app.getPath("userData"), "project-assets");
const masterDir = () => path.join(app.getPath("movies"), "Brightside Film Remote", "KESSLER");
const assetDir = () => path.join(masterDir(), "Genererede billeder");
const importedDir = () => path.join(masterDir(), "Importerede referencer");
const promptDir = () => path.join(masterDir(), "Prompts");

function safeFilePart(value) {
  return String(value || "reference").replace(/[^a-z0-9æøå_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "reference";
}

function uniqueDestination(directory, filename) {
  const parsed = path.parse(filename);
  let destination = path.join(directory, filename);
  let number = 2;
  while (fs.existsSync(destination)) {
    destination = path.join(directory, `${parsed.name}-${number}${parsed.ext}`);
    number += 1;
  }
  return destination;
}

function ensureMasterFolder() {
  [masterDir(), assetDir(), importedDir(), promptDir(), path.join(masterDir(), "Character sheets"), path.join(masterDir(), "Location maps")]
    .forEach(directory => fs.mkdirSync(directory, { recursive: true }));
  const profilePath = path.join(masterDir(), "KESSLER-profil.json");
  if (!fs.existsSync(profilePath)) fs.writeFileSync(profilePath, JSON.stringify(KESSLER_PROFILE, null, 2));

  const state = loadState();
  let changed = false;
  for (const item of state.imports) {
    if (!item.path || !fs.existsSync(item.path) || !item.path.startsWith(legacyAssetDir())) continue;
    const destination = uniqueDestination(importedDir(), item.name || path.basename(item.path));
    fs.copyFileSync(item.path, destination);
    item.path = destination;
    changed = true;
  }
  if (changed) saveState(state);
}

function appendPromptLog(userText, assistantText) {
  fs.mkdirSync(promptDir(), { recursive: true });
  const timestamp = new Date().toISOString();
  fs.appendFileSync(path.join(promptDir(), "Brightside-prompt-log.md"), `\n## ${timestamp}\n\n**Nicolas:** ${userText}\n\n**Brightside:** ${assistantText}\n`);
}

function initialState() {
  return { project: KESSLER_PROFILE, imports: [], model: "gpt-5.6-terra", encryptedApiKey: null, conversation: [], autoUpdate: true, updateFeedUrl: "" };
}

function loadState() {
  try { return {...initialState(), ...JSON.parse(fs.readFileSync(statePath(), "utf8"))}; }
  catch { return initialState(); }
}

function saveState(next) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(next, null, 2));
}

function getApiKey(state) {
  if (!state.encryptedApiKey) return "";
  try { return safeStorage.decryptString(Buffer.from(state.encryptedApiKey, "base64")); }
  catch { return ""; }
}

function layout() {
  if (!mainWindow || !higgsView) return;
  const [width, height] = mainWindow.getContentSize();
  const sidebar = Math.max(390, Math.min(520, Math.floor(width * 0.34)));
  higgsView.setBounds({ x: sidebar, y: 54, width: Math.max(1, width - sidebar), height: Math.max(1, height - 54) });
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1540, height: 980, minWidth: 1100, minHeight: 720,
    title: "Brightside Film Remote",
    show: false,
    backgroundColor: "#0b0b0c",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
  });
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
  }, 1500);
  mainWindow.loadFile(path.join(__dirname, "index.html")).catch(error => {
    dialog.showErrorBox("Brightside Film Remote kunne ikke åbne", error.message);
  });

  higgsView = new WebContentsView({
    webPreferences: {
      partition: "persist:higgsfield",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.contentView.addChildView(higgsView);
  higgsView.webContents.loadURL("https://higgsfield.ai/");
  higgsView.webContents.setWindowOpenHandler(({url}) => { higgsView.webContents.loadURL(url); return {action: "deny"}; });
  layout();
  mainWindow.on("resize", layout);
  higgsView.webContents.on("did-navigate", (_e, url) => mainWindow?.webContents.send("higgs:url", url));
  mainWindow.on("closed", () => {
    mainWindow = null;
    higgsView = null;
  });
}

async function screenshotDataUrl() {
  const image = await higgsView.webContents.capturePage();
  return image.toDataURL();
}

function importedReferenceImages(imports) {
  return imports
    .filter(item => ["jpg", "jpeg", "png", "webp"].includes(item.kind) && fs.existsSync(item.path))
    .slice(-6)
    .map(item => {
      const source = nativeImage.createFromPath(item.path);
      const size = source.getSize();
      const image = size.width > 1200 ? source.resize({width:1200, quality:"good"}) : source;
      return {type:"input_image", image_url:`data:image/jpeg;base64,${image.toJPEG(78).toString("base64")}`, detail:"high"};
    });
}

const tools = [
  {type:"function", name:"click", description:"Click a coordinate in the visible Higgsfield area.", strict:true, parameters:{type:"object", additionalProperties:false, properties:{x:{type:"number"},y:{type:"number"},purpose:{type:"string"},risk:{type:"string",enum:["safe","credit_spend","external_effect"]}}, required:["x","y","purpose","risk"]}},
  {type:"function", name:"type_text", description:"Type into the currently focused field.", strict:true, parameters:{type:"object", additionalProperties:false, properties:{text:{type:"string"},purpose:{type:"string"},risk:{type:"string",enum:["safe","credit_spend","external_effect"]}}, required:["text","purpose","risk"]}},
  {type:"function", name:"press_key", description:"Press a keyboard key such as ENTER, ESCAPE, TAB, or BACKSPACE.", strict:true, parameters:{type:"object", additionalProperties:false, properties:{key:{type:"string"},purpose:{type:"string"},risk:{type:"string",enum:["safe","credit_spend","external_effect"]}}, required:["key","purpose","risk"]}},
  {type:"function", name:"scroll", description:"Scroll the visible Higgsfield page.", strict:true, parameters:{type:"object", additionalProperties:false, properties:{deltaY:{type:"number"},purpose:{type:"string"},risk:{type:"string",enum:["safe","credit_spend","external_effect"]}}, required:["deltaY","purpose","risk"]}},
  {type:"function", name:"navigate", description:"Navigate only within higgsfield.ai.", strict:true, parameters:{type:"object", additionalProperties:false, properties:{url:{type:"string"},purpose:{type:"string"},risk:{type:"string",enum:["safe","credit_spend","external_effect"]}}, required:["url","purpose","risk"]}},
  {type:"function", name:"wait", description:"Wait briefly for the interface.", strict:true, parameters:{type:"object", additionalProperties:false, properties:{milliseconds:{type:"number"},purpose:{type:"string"},risk:{type:"string",enum:["safe","credit_spend","external_effect"]}}, required:["milliseconds","purpose","risk"]}}
];

async function executeTool(name, args) {
  if (args.risk !== "safe") {
    if (args.risk === "credit_spend" && creditApprovalBudget > 0) {
      creditApprovalBudget -= 1;
      mainWindow.webContents.send("approval:budget", creditApprovalBudget);
    } else {
    const approved = await askApproval(args.purpose, args.risk);
    if (!approved) return {ok:false, denied:true, message:"Nicolas afviste handlingen."};
    }
  }
  if (name === "click") { higgsView.webContents.sendInputEvent({type:"mouseDown", x:Math.round(args.x), y:Math.round(args.y), button:"left", clickCount:1}); higgsView.webContents.sendInputEvent({type:"mouseUp", x:Math.round(args.x), y:Math.round(args.y), button:"left", clickCount:1}); }
  else if (name === "type_text") { higgsView.webContents.insertText(args.text); }
  else if (name === "press_key") { const key = args.key.length === 1 ? args.key : args.key; higgsView.webContents.sendInputEvent({type:"keyDown", keyCode:key}); higgsView.webContents.sendInputEvent({type:"keyUp", keyCode:key}); }
  else if (name === "scroll") { higgsView.webContents.sendInputEvent({type:"mouseWheel", x:300, y:300, deltaY:args.deltaY, deltaX:0, canScroll:true}); }
  else if (name === "navigate") { const target = new URL(args.url); if (!/(^|\.)higgsfield\.ai$/.test(target.hostname)) throw new Error("Navigation uden for Higgsfield er blokeret"); await higgsView.webContents.loadURL(target.toString()); }
  else if (name === "wait") { await new Promise(r => setTimeout(r, Math.min(Math.max(args.milliseconds, 100), 5000))); }
  return {ok:true};
}

function askApproval(purpose, risk) {
  return new Promise(resolve => {
    pendingApproval = decision => {
      if (decision === "ten" && risk === "credit_spend") {
        creditApprovalBudget = 9;
        mainWindow.webContents.send("approval:budget", creditApprovalBudget);
        resolve(true);
      } else resolve(decision === "once");
    };
    mainWindow.webContents.send("approval:request", {purpose, risk});
  });
}

async function runAssistant(userText, selectedEngine = "auto") {
  const state = loadState();
  const apiKey = getApiKey(state);
  if (!apiKey) throw new Error("Tilføj først din OpenAI API-nøgle under Indstillinger.");
  const client = new OpenAI({apiKey});
  const imported = state.imports.map(x => `${x.name}: ${x.summary || "visuel reference"}`).join("\n").slice(0, 50000);
  const screenshot = await screenshotDataUrl();
  const references = importedReferenceImages(state.imports);
  let input = [
    ...state.conversation.slice(-12),
    {role:"user", content:[
      {type:"input_text", text:`VALGT WORKFLOW/ENGINE: ${selectedEngine}. Ved auto skal du vælge den bedste engine og forklare valget kort før handling.\n\nOPGAVE FRA NICOLAS:\n${userText}`},
      {type:"input_image", image_url:screenshot, detail:"high"},
      ...references
    ]}
  ];
  let finalText = "";
  for (let turn = 0; turn < 12; turn++) {
    const response = await client.responses.create({model:state.model, instructions:buildSystemPrompt(state.project, imported), input, tools, tool_choice:"auto"});
    finalText = response.output_text || finalText;
    const calls = response.output.filter(x => x.type === "function_call");
    if (!calls.length) break;
    input = [...input, ...response.output];
    for (const call of calls) {
      const args = JSON.parse(call.arguments);
      let result;
      try { result = await executeTool(call.name, args); }
      catch (error) { result = {ok:false, error:error.message}; }
      const after = await screenshotDataUrl();
      input.push({type:"function_call_output", call_id:call.call_id, output:JSON.stringify(result)});
      input.push({role:"user", content:[{type:"input_text", text:"Aktuel Higgsfield-skærm efter handlingen:"},{type:"input_image", image_url:after, detail:"high"}]});
      if (result.denied) break;
    }
  }
  state.conversation.push({role:"user", content:userText}, {role:"assistant", content:finalText || "Handlingen er udført."});
  state.conversation = state.conversation.slice(-30);
  saveState(state);
  appendPromptLog(userText, finalText || "Handlingen er udført.");
  return finalText || "Handlingen er udført.";
}

async function importFiles() {
  const result = await dialog.showOpenDialog(mainWindow, {properties:["openFile","multiSelections"], filters:[{name:"Lookbooks, manus og referencer", extensions:["pdf","txt","md","jpg","jpeg","png","webp"]}]});
  if (result.canceled) return [];
  const state = loadState();
  fs.mkdirSync(importedDir(), {recursive:true});
  for (const source of result.filePaths) {
    const ext = path.extname(source).toLowerCase();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const destination = uniqueDestination(importedDir(), `${id}-${safeFilePart(path.basename(source, ext))}${ext}`);
    fs.copyFileSync(source, destination);
    let summary = "Visuel reference. Brug motiv, farve, tekstur, kostume og lys som analysegrundlag — kopiér ikke automatisk alle egenskaber.";
    if (ext === ".pdf") { const parsed = await pdf(fs.readFileSync(destination)); summary = parsed.text.slice(0, 18000); }
    if (ext === ".txt" || ext === ".md") summary = fs.readFileSync(destination, "utf8").slice(0, 18000);
    state.imports.push({id, name:path.basename(source), path:destination, kind:ext.slice(1), summary});
  }
  saveState(state);
  return state.imports.map(({path: _path, ...safe}) => safe);
}

async function transcribeAudio(arrayBuffer, mimeType) {
  const state = loadState();
  const apiKey = getApiKey(state);
  if (!apiKey) throw new Error("Tilføj først din OpenAI API-nøgle.");
  const ext = mimeType.includes("mp4") ? "m4a" : "webm";
  const temp = path.join(app.getPath("temp"), `brightside-voice-${Date.now()}.${ext}`);
  fs.writeFileSync(temp, Buffer.from(arrayBuffer));
  try {
    const client = new OpenAI({apiKey});
    const result = await client.audio.transcriptions.create({file:fs.createReadStream(temp), model:"gpt-4o-mini-transcribe", language:"da"});
    return result.text;
  } finally { fs.unlink(temp, () => {}); }
}

async function createReferenceImage({brief, kind, ratio, quality, useReferences}) {
  const state = loadState();
  const apiKey = getApiKey(state);
  if (!apiKey) throw new Error("Tilføj først din OpenAI API-nøgle.");
  const approved = creditApprovalBudget > 0
    ? (creditApprovalBudget -= 1, mainWindow.webContents.send("approval:budget", creditApprovalBudget), true)
    : await askApproval(`Skab ét ${kind}-referencebillede med GPT Image 2 i ${quality} kvalitet`, "credit_spend");
  if (!approved) throw new Error("Billedgenereringen blev stoppet.");
  const size = ratio === "portrait" ? "1024x1536" : ratio === "square" ? "1024x1024" : "1536x1024";
  const client = new OpenAI({apiKey});
  const prompt = `${buildSystemPrompt(state.project, "")}

Create a production-ready ${kind} for film development. User brief: ${brief}
${ratio === "cinemascope" ? "Compose strictly for CinemaScope 2.39:1 with safe framing across the full widescreen canvas." : ""}
This is a still reference asset, not a finished video. Make it useful for identity, continuity, location, costume, props, lighting and later image-to-video prompting. No text labels unless the brief explicitly requests them.`;
  const referencePaths = useReferences ? state.imports
    .filter(item => ["jpg", "jpeg", "png", "webp"].includes(item.kind) && fs.existsSync(item.path))
    .slice(-4).map(item => item.path) : [];
  const result = referencePaths.length
    ? await client.images.edit({
        model:"gpt-image-2",
        image:await Promise.all(referencePaths.map(file => toFile(fs.createReadStream(file), path.basename(file), {type:`image/${path.extname(file).slice(1).replace("jpg","jpeg")}`}))),
        prompt, size, quality:quality || "medium"
      })
    : await client.images.generate({model:"gpt-image-2", prompt, size, quality:quality || "medium"});
  const sourceB64 = result.data?.[0]?.b64_json;
  if (!sourceB64) throw new Error("Billedmodellen returnerede ingen billeddata.");
  let outputBuffer = Buffer.from(sourceB64, "base64");
  if (ratio === "cinemascope") {
    const sourceImage = nativeImage.createFromBuffer(outputBuffer);
    const dimensions = sourceImage.getSize();
    const targetHeight = Math.round(dimensions.width / 2.39);
    const y = Math.max(0, Math.floor((dimensions.height - targetHeight) / 2));
    outputBuffer = sourceImage.crop({x:0, y, width:dimensions.width, height:Math.min(targetHeight, dimensions.height)}).toPNG();
  }
  const b64 = outputBuffer.toString("base64");
  const category = kind === "character sheet" ? "Character sheets" : kind === "location map" ? "Location maps" : "Genererede billeder";
  const outputDirectory = path.join(masterDir(), category);
  fs.mkdirSync(outputDirectory, {recursive:true});
  const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const destination = path.join(outputDirectory, `${safeFilePart(kind)}-${id}.png`);
  fs.writeFileSync(destination, outputBuffer);
  state.imports.push({id, name:`${kind}-${id}.png`, path:destination, kind:"png", summary:`AI-skabt ${kind}. Brief: ${brief}`});
  saveState(state);
  return {id, name:`${kind}-${id}.png`, dataUrl:`data:image/png;base64,${b64}`, kind:"png", summary:`AI-skabt ${kind}. Brief: ${brief}`};
}

app.whenReady().then(() => {
  if (!fs.existsSync(statePath())) saveState(initialState());
  ensureMasterFolder();
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media"));
  createWindow();
  checkForUpdates = setupUpdater({getSettings:loadState, notify:message => mainWindow?.webContents.send("update:status", message)});
  ipcMain.handle("state:get", () => { const s = loadState(); return {...s, encryptedApiKey:undefined, hasApiKey:Boolean(getApiKey(s)), imports:s.imports.map(({path:_p,...x})=>x), workflows:HIGGSFIELD_WORKFLOWS}; });
  ipcMain.handle("settings:save", (_e, {apiKey, model, autoUpdate, updateFeedUrl}) => { const s=loadState(); if(apiKey) s.encryptedApiKey=safeStorage.encryptString(apiKey).toString("base64"); if(model) s.model=model; if(typeof autoUpdate==="boolean") s.autoUpdate=autoUpdate; if(typeof updateFeedUrl==="string") s.updateFeedUrl=updateFeedUrl.trim(); saveState(s); return {ok:true, hasApiKey:Boolean(getApiKey(s))}; });
  ipcMain.handle("assistant:run", (_e, text, engine) => runAssistant(text, engine));
  ipcMain.handle("project:import", () => importFiles());
  ipcMain.handle("project:remove", (_e, id) => { const s=loadState(); const item=s.imports.find(x=>x.id===id); if(item) fs.unlink(item.path,()=>{}); s.imports=s.imports.filter(x=>x.id!==id); saveState(s); return s.imports.map(({path:_p,...x})=>x); });
  ipcMain.handle("voice:transcribe", (_e, data, mime) => transcribeAudio(data, mime));
  ipcMain.handle("image:create", (_e, request) => createReferenceImage(request));
  ipcMain.handle("higgs:navigate", async (_e, url) => { await higgsView.webContents.loadURL(url); return true; });
  ipcMain.handle("update:check", () => checkForUpdates?.());
  ipcMain.handle("project:open-folder", () => shell.openPath(masterDir()));
  ipcMain.on("approval:decision", (_e, decision) => { if(pendingApproval){ pendingApproval(decision); pendingApproval=null; } });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else {
    mainWindow?.show();
    mainWindow?.focus();
  }
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", stopUpdater);
