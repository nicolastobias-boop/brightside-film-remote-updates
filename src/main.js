const { app, BrowserWindow, WebContentsView, ipcMain, dialog, safeStorage, session, nativeImage, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
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
const elementsDir = () => path.join(masterDir(), "Elementer");
const characterDir = () => path.join(elementsDir(), "Karakterer");
const locationDir = () => path.join(elementsDir(), "Locations");
const scenesDir = () => path.join(masterDir(), "Scener");
const aiKnowledgeDir = () => path.join(masterDir(), "AI-viden");
const sceneDir = scene => path.join(scenesDir(), scene.folder);
const sceneRefsDir = scene => path.join(sceneDir(scene), "Referencer");
const sceneWorkDir = scene => path.join(sceneDir(scene), "Work");
const sceneFinalDir = scene => path.join(sceneDir(scene), "Final");
const localEditorDeliveryDir = () => path.join(masterDir(), "Godkendt til Allan");
const teamDir = () => path.join(masterDir(), "Team");
const teamAttachmentsDir = () => path.join(teamDir(), "Vedhæftninger");

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

function copyLegacyElements(source, destination) {
  if (!fs.existsSync(source)) return;
  for (const entry of fs.readdirSync(source, {withFileTypes:true})) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const target = path.join(destination, entry.name);
    if (!fs.existsSync(target)) fs.copyFileSync(path.join(source, entry.name), target);
  }
}

function ensureSceneFolders(scene) {
  [sceneDir(scene), sceneRefsDir(scene), sceneWorkDir(scene), sceneFinalDir(scene)]
    .forEach(directory => fs.mkdirSync(directory, {recursive:true}));
}

function ensureMasterFolder() {
  [masterDir(), assetDir(), importedDir(), promptDir(), elementsDir(), characterDir(), locationDir(), scenesDir(), aiKnowledgeDir(), localEditorDeliveryDir(), teamDir(), teamAttachmentsDir(), path.join(masterDir(), "Character sheets"), path.join(masterDir(), "Location maps")]
    .forEach(directory => fs.mkdirSync(directory, { recursive: true }));
  copyLegacyElements(path.join(masterDir(), "Character sheets"), characterDir());
  copyLegacyElements(path.join(masterDir(), "Location maps"), locationDir());
  const profilePath = path.join(masterDir(), "KESSLER-profil.json");
  if (!fs.existsSync(profilePath)) fs.writeFileSync(profilePath, JSON.stringify(KESSLER_PROFILE, null, 2));

  const state = loadState();
  state.scenes.forEach(ensureSceneFolders);
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
  const entry = `\n## ${timestamp}\n\n**Nicolas:** ${userText}\n\n**Brightside:** ${assistantText}\n`;
  fs.appendFileSync(path.join(promptDir(), "Brightside-prompt-log.md"), entry);
  const state = loadState();
  const scene = state.scenes.find(item => item.id === state.activeSceneId);
  if (scene) {
    ensureSceneFolders(scene);
    fs.appendFileSync(path.join(sceneWorkDir(scene), "Prompts.md"), entry);
  }
}

function initialState() {
  return { project: KESSLER_PROFILE, imports: [], aiKnowledge: [], scenes: [], activeSceneId: null, currentUserRole: "admin", currentUserName: "Nicolas", onboardingCompleted: false, teamMessages: [], editorName: "Allan", editorDeliveryDir: "", editorDeliveries: [], privateAssets: {}, model: "gpt-5.6-terra", encryptedApiKey: null, conversation: [], autoUpdate: true, updateFeedUrl: "" };
}

function loadState() {
  try {
    const state = {...initialState(), ...JSON.parse(fs.readFileSync(statePath(), "utf8"))};
    if (!Array.isArray(state.imports)) state.imports = [];
    if (!Array.isArray(state.aiKnowledge)) state.aiKnowledge = [];
    if (!Array.isArray(state.scenes)) state.scenes = [];
    if (!Array.isArray(state.editorDeliveries)) state.editorDeliveries = [];
    if (!Array.isArray(state.teamMessages)) state.teamMessages = [];
    if (!state.privateAssets || typeof state.privateAssets !== "object") state.privateAssets = {};
    return state;
  } catch { return initialState(); }
}

function saveState(next) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(next, null, 2));
}

function imageThumbnail(filePath) {
  if (!/\.(jpe?g|png|webp)$/i.test(filePath)) return "";
  try {
    const source = nativeImage.createFromPath(filePath);
    if (source.isEmpty()) return "";
    const size = source.getSize();
    const image = size.width > 420 ? source.resize({width:420, quality:"good"}) : source;
    return image.toDataURL();
  } catch { return ""; }
}

function listAssets(directory, category) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, {withFileTypes:true})
    .filter(entry => entry.isFile() && !entry.name.startsWith("."))
    .map(entry => {
      const filePath = path.join(directory, entry.name);
      return {id:`${category}:${entry.name}`, name:entry.name, category, thumbnail:imageThumbnail(filePath)};
    });
}

function activeScene(state = loadState()) {
  return state.scenes.find(scene => scene.id === state.activeSceneId) || null;
}

function continuitySnapshot() {
  const state = loadState();
  const scene = activeScene(state);
  if (scene) ensureSceneFolders(scene);
  return {
    scenes: state.scenes.map(item => ({id:item.id, title:item.title, folder:item.folder, privateOnly:Boolean(item.privateOnly), active:item.id === state.activeSceneId})),
    activeSceneId: state.activeSceneId,
    currentUserRole: state.currentUserRole || "admin",
    characters: listAssets(characterDir(), "character"),
    locations: listAssets(locationDir(), "location"),
    references: scene ? listAssets(sceneRefsDir(scene), "reference") : [],
    work: scene ? listAssets(sceneWorkDir(scene), "work").map(item => ({...item, privateOnly:Boolean(state.privateAssets[`${scene.id}:work:${item.name}`])})) : [],
    final: scene ? listAssets(sceneFinalDir(scene), "final").map(item => ({...item, privateOnly:Boolean(state.privateAssets[`${scene.id}:final:${item.name}`])})) : [],
    editorName: state.editorName || "Allan",
    editorDeliveryDir: state.editorDeliveryDir || localEditorDeliveryDir(),
    editorDeliveryCustom: Boolean(state.editorDeliveryDir),
    editorDeliveries: scene ? state.editorDeliveries.filter(item => item.sceneId === scene.id) : []
  };
}

function createScene(payload) {
  const state = loadState();
  const title = typeof payload === "string" ? payload : payload?.title;
  const privateOnly = typeof payload === "object" && Boolean(payload?.privateOnly);
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) throw new Error("Skriv et navn til scenen.");
  const number = String(state.scenes.length + 1).padStart(3, "0");
  const scene = {id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`, title:cleanTitle, folder:`${number}-${safeFilePart(cleanTitle)}`, privateOnly, createdAt:new Date().toISOString()};
  state.scenes.push(scene);
  state.activeSceneId = scene.id;
  ensureSceneFolders(scene);
  saveState(state);
  return continuitySnapshot();
}

async function importContinuityFiles(category) {
  const state = loadState();
  const scene = activeScene(state);
  const destinations = {character:characterDir(), location:locationDir(), scene:scene && sceneRefsDir(scene)};
  const destinationDirectory = destinations[category];
  if (!destinationDirectory) throw new Error("Opret eller vælg først en scene.");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: category === "character" ? "Tilføj karakterer" : category === "location" ? "Tilføj locations" : "Tilføj referencer til scenen",
    properties:["openFile","multiSelections"],
    filters:[{name:"Billeder, PDF og noter", extensions:["pdf","txt","md","jpg","jpeg","png","webp"]}]
  });
  if (result.canceled) return continuitySnapshot();
  fs.mkdirSync(destinationDirectory, {recursive:true});
  for (const source of result.filePaths) {
    const destination = uniqueDestination(destinationDirectory, path.basename(source));
    fs.copyFileSync(source, destination);
  }
  return continuitySnapshot();
}

function elementPathFromId(id) {
  const [category, ...nameParts] = String(id).split(":");
  const name = path.basename(nameParts.join(":"));
  if (!name) return null;
  if (category === "character") return path.join(characterDir(), name);
  if (category === "location") return path.join(locationDir(), name);
  return null;
}

function addElementsToScene(ids) {
  const state = loadState();
  const scene = activeScene(state);
  if (!scene) throw new Error("Opret eller vælg først en scene.");
  ensureSceneFolders(scene);
  for (const id of Array.isArray(ids) ? ids : []) {
    const source = elementPathFromId(id);
    if (!source || !fs.existsSync(source)) continue;
    const destination = uniqueDestination(sceneRefsDir(scene), path.basename(source));
    fs.copyFileSync(source, destination);
  }
  return continuitySnapshot();
}

function moveWorkToFinal(filename) {
  const state = loadState();
  const scene = activeScene(state);
  if (!scene) throw new Error("Vælg først en scene.");
  const safeName = path.basename(String(filename || ""));
  const source = path.join(sceneWorkDir(scene), safeName);
  if (!safeName || !fs.existsSync(source)) throw new Error("Work-filen kunne ikke findes.");
  const destination = uniqueDestination(sceneFinalDir(scene), safeName);
  fs.renameSync(source, destination);
  return continuitySnapshot();
}

function teamSnapshot() {
  const state=loadState();
  return {online:false,backendReady:false,currentUser:{name:state.currentUserName||"Nicolas",role:state.currentUserRole||"admin"},devices:[{id:state.deviceId||"local",name:os.hostname(),user:state.currentUserName||"Nicolas",role:state.currentUserRole||"admin",version:app.getVersion(),lastSeen:new Date().toISOString(),online:true}],messages:state.teamMessages.slice(-200).map(({attachmentPath:_p,...item})=>item)};
}
function saveTeamProfile(name) {
  const state=loadState(); const clean=String(name||"").trim(); if(clean) state.currentUserName=clean; if(!state.deviceId) state.deviceId=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`; saveState(state); return teamSnapshot();
}
function sendTeamMessage(text) {
  const state=loadState(),clean=String(text||"").trim(); if(!clean) return teamSnapshot();
  state.teamMessages.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,author:state.currentUserName||"Nicolas",text:clean,createdAt:new Date().toISOString(),pendingSync:true}); saveState(state); return teamSnapshot();
}
async function attachTeamFiles() {
  const state=loadState(),result=await dialog.showOpenDialog(mainWindow,{title:"Vedhæft filer til KESSLER-chatten",properties:["openFile","multiSelections"]}); if(result.canceled) return teamSnapshot();
  fs.mkdirSync(teamAttachmentsDir(),{recursive:true});
  for(const source of result.filePaths){const destination=uniqueDestination(teamAttachmentsDir(),path.basename(source));fs.copyFileSync(source,destination);state.teamMessages.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,author:state.currentUserName||"Nicolas",text:"Vedhæftede en fil",attachment:path.basename(destination),attachmentPath:destination,createdAt:new Date().toISOString(),pendingSync:true});}
  saveState(state); return teamSnapshot();
}
function openTeamAttachments(){fs.mkdirSync(teamAttachmentsDir(),{recursive:true});return shell.openPath(teamAttachmentsDir());}

function assertAdmin(state) {
  if ((state.currentUserRole || "admin") !== "admin") throw new Error("Kun en Brightside Admin kan ændre privatstatus.");
}
function setScenePrivate(privateOnly) {
  const state=loadState(); assertAdmin(state); const scene=activeScene(state); if(!scene) throw new Error("Vælg først en scene.");
  scene.privateOnly=Boolean(privateOnly); saveState(state); return continuitySnapshot();
}
function setAssetPrivate({category,filename,privateOnly}) {
  const state=loadState(); assertAdmin(state); const scene=activeScene(state); if(!scene) throw new Error("Vælg først en scene.");
  if(!["work","final"].includes(category)) throw new Error("Ugyldig mappe.");
  const safeName=path.basename(String(filename||"")), directory=category==="work"?sceneWorkDir(scene):sceneFinalDir(scene);
  if(!safeName||!fs.existsSync(path.join(directory,safeName))) throw new Error("Filen kunne ikke findes.");
  const key=`${scene.id}:${category}:${safeName}`; if(privateOnly) state.privateAssets[key]=true; else delete state.privateAssets[key];
  saveState(state); return continuitySnapshot();
}
function editorMasterName(scene,filename,version) {
  const parsed=path.parse(filename),number=String(scene.folder||"000").split("-")[0].padStart(3,"0");
  return `KESSLER_SC${number}_${safeFilePart(scene.title).toUpperCase()}_${safeFilePart(parsed.name).toUpperCase()}_MASTER_v${String(version).padStart(3,"0")}${parsed.ext.toLowerCase()}`;
}
async function chooseEditorDeliveryFolder() {
  const state=loadState(), result=await dialog.showOpenDialog(mainWindow,{title:"Vælg Allans leveringsmappe",defaultPath:state.editorDeliveryDir||localEditorDeliveryDir(),properties:["openDirectory","createDirectory"]});
  if(result.canceled||!result.filePaths[0]) return continuitySnapshot(); state.editorDeliveryDir=result.filePaths[0]; saveState(state); return continuitySnapshot();
}
function deliverFinalToEditor(filename) {
  const state=loadState(),scene=activeScene(state); if(!scene) throw new Error("Vælg først en scene.");
  const safeName=path.basename(String(filename||"")); if(scene.privateOnly||state.privateAssets[`${scene.id}:final:${safeName}`]) throw new Error("Filen er markeret Kun hos mig. Fjern fluebenet før aflevering til Allan.");
  const source=path.join(sceneFinalDir(scene),safeName); if(!safeName||!fs.existsSync(source)) throw new Error("Final-filen kunne ikke findes.");
  const root=state.editorDeliveryDir||localEditorDeliveryDir(),destinationDir=path.join(root,scene.folder); fs.mkdirSync(destinationDir,{recursive:true});
  const version=state.editorDeliveries.filter(item=>item.sceneId===scene.id&&item.sourceName===safeName).length+1,masterName=editorMasterName(scene,safeName,version),destination=path.join(destinationDir,masterName);
  fs.copyFileSync(source,destination); state.editorDeliveries.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,sceneId:scene.id,sceneTitle:scene.title,sceneFolder:scene.folder,sourceName:safeName,masterName,version,approvedFor:state.editorName||"Allan",approvedAt:new Date().toISOString(),destination}); saveState(state);
  const deliveries=state.editorDeliveries.filter(item=>item.sceneId===scene.id).map(({destination:_p,...item})=>item);
  fs.writeFileSync(path.join(destinationDir,"BRIGHTSIDE-delivery-manifest.json"),JSON.stringify({project:"KESSLER",frameRate:25,aspectRatio:"2.39:1",scene:{id:scene.id,title:scene.title,folder:scene.folder},deliveries},null,2));
  return continuitySnapshot();
}
function openEditorDeliveryFolder() {
  const state=loadState(),directory=state.editorDeliveryDir||localEditorDeliveryDir(); fs.mkdirSync(directory,{recursive:true}); return shell.openPath(directory);
}

function activeSceneReferencePaths(state) {
  const scene = activeScene(state);
  if (!scene || !fs.existsSync(sceneRefsDir(scene))) return [];
  return fs.readdirSync(sceneRefsDir(scene))
    .filter(name => /\.(jpe?g|png|webp)$/i.test(name))
    .map(name => path.join(sceneRefsDir(scene), name));
}

function sourceFolder(sourceType) {
  const names = {claude:"Claude", higgsfield:"Higgsfield", other:"Andre AI"};
  const folder = names[sourceType] || names.other;
  const directory = path.join(aiKnowledgeDir(), folder);
  fs.mkdirSync(directory, {recursive:true});
  return directory;
}

function flattenJsonText(value, output = [], depth = 0) {
  if (output.join("\n").length > 60000 || depth > 30) return output;
  if (typeof value === "string") {
    const clean = value.trim();
    if (clean.length > 1) output.push(clean);
  } else if (Array.isArray(value)) {
    value.forEach(item => flattenJsonText(item, output, depth + 1));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach(item => flattenJsonText(item, output, depth + 1));
  }
  return output;
}

function walkKnowledgeFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, {withFileTypes:true})) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkKnowledgeFiles(full));
    else if (/\.(json|md|txt|pdf|csv|html?|jpe?g|png|webp)$/i.test(entry.name)) files.push(full);
  }
  return files;
}

async function extractKnowledgeText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    const parsed = await pdf(fs.readFileSync(filePath));
    return parsed.text.slice(0, 60000);
  }
  if (ext === ".json") {
    try { return flattenJsonText(JSON.parse(fs.readFileSync(filePath, "utf8"))).join("\n").slice(0, 60000); }
    catch { return fs.readFileSync(filePath, "utf8").slice(0, 60000); }
  }
  if ([".txt",".md",".csv",".html",".htm"].includes(ext)) {
    let text = fs.readFileSync(filePath, "utf8");
    if (ext === ".html" || ext === ".htm") text = text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
    return text.replace(/\s+/g, " ").trim().slice(0, 60000);
  }
  return "Visuel reference importeret fra en anden AI-session.";
}

async function registerKnowledgeFile(sourcePath, sourceType, state) {
  const ext = path.extname(sourcePath).toLowerCase();
  const destination = uniqueDestination(sourceFolder(sourceType), path.basename(sourcePath));
  fs.copyFileSync(sourcePath, destination);
  const text = await extractKnowledgeText(destination);
  const item = {id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`, source:sourceType, name:path.basename(sourcePath), path:destination, summary:text, importedAt:new Date().toISOString()};
  state.aiKnowledge.push(item);
  if ([".jpg",".jpeg",".png",".webp"].includes(ext)) {
    state.imports.push({id:item.id, name:item.name, path:destination, kind:ext.slice(1), summary:`Visuel reference fra ${sourceType}: ${item.name}`});
  }
}

async function importAiKnowledge(sourceType) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:"Importér viden fra Claude, Higgsfield eller en anden AI",
    properties:["openFile","multiSelections"],
    filters:[{name:"AI-eksport, chats, prompts og referencer", extensions:["zip","json","md","txt","pdf","csv","html","htm","jpg","jpeg","png","webp"]}]
  });
  if (result.canceled) return aiKnowledgeSnapshot();
  const state = loadState();
  for (const source of result.filePaths) {
    if (path.extname(source).toLowerCase() === ".zip") {
      const temp = fs.mkdtempSync(path.join(app.getPath("temp"), "brightside-ai-import-"));
      try {
        execFileSync("/usr/bin/ditto", ["-x","-k",source,temp]);
        for (const file of walkKnowledgeFiles(temp)) await registerKnowledgeFile(file, sourceType, state);
      } finally { fs.rmSync(temp, {recursive:true, force:true}); }
    } else await registerKnowledgeFile(source, sourceType, state);
  }
  saveState(state);
  return aiKnowledgeSnapshot();
}

function saveAiKnowledgeText({sourceType, title, text}) {
  const cleanText = String(text || "").trim();
  if (!cleanText) throw new Error("Indsæt først samtalen eller prompt-viden.");
  const state = loadState();
  const name = `${safeFilePart(title || "AI-samtale")}-${Date.now()}.md`;
  const destination = path.join(sourceFolder(sourceType), name);
  fs.writeFileSync(destination, cleanText);
  state.aiKnowledge.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`, source:sourceType, name, path:destination, summary:cleanText.slice(0,60000), importedAt:new Date().toISOString()});
  saveState(state);
  return aiKnowledgeSnapshot();
}

function aiKnowledgeSnapshot() {
  const state = loadState();
  return state.aiKnowledge.map(item => ({
    id:item.id, source:item.source, name:item.name, importedAt:item.importedAt,
    excerpt:String(item.summary || "").replace(/\s+/g, " ").slice(0,240)
  })).reverse();
}

function removeAiKnowledge(id) {
  const state = loadState();
  const item = state.aiKnowledge.find(entry => entry.id === id);
  if (item?.path && item.path.startsWith(aiKnowledgeDir()) && fs.existsSync(item.path)) fs.unlinkSync(item.path);
  state.aiKnowledge = state.aiKnowledge.filter(entry => entry.id !== id);
  state.imports = state.imports.filter(entry => entry.id !== id);
  saveState(state);
  return aiKnowledgeSnapshot();
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
  const scene = activeScene(state);
  const sceneReferences = scene ? listAssets(sceneRefsDir(scene), "reference").map(item => item.name).join(", ") : "";
  const externalKnowledge = state.aiKnowledge.map(item => `[${item.source.toUpperCase()} · ${item.name}]\n${item.summary || ""}`).join("\n\n").slice(-80000);
  const imported = [
    state.imports.map(x => `${x.name}: ${x.summary || "visuel reference"}`).join("\n"),
    externalKnowledge ? `IMPORTERET AI-VIDEN FRA CLAUDE/HIGGSFIELD/ANDRE:\n${externalKnowledge}` : "INGEN IMPORTERET AI-VIDEN",
    scene ? `AKTIV SCENE: ${scene.title}. Kontinuitetsreferencer: ${sceneReferences || "ingen valgt endnu"}` : "INGEN AKTIV SCENE"
  ].join("\n").slice(0, 50000);
  const screenshot = await screenshotDataUrl();
  const references = importedReferenceImages(state.imports);
  let input = [
    ...state.conversation.slice(-12),
    {role:"user", content:[
      {type:"input_text", text:`VALGT WORKFLOW/ENGINE: ${selectedEngine}. Ved auto skal du vælge den bedste engine og forklare valget kort før handling. FAST PROJEKT-TIMEBASE: 25 fps. Brug og eksportér 25 fps; andre billedhastigheder er kun optageeffekter, der skal konformes til 25 fps.\n\nOPGAVE FRA NICOLAS:\n${userText}`},
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
  const referencePaths = useReferences ? [
    ...activeSceneReferencePaths(state),
    ...state.imports.filter(item => ["jpg", "jpeg", "png", "webp"].includes(item.kind) && fs.existsSync(item.path)).map(item => item.path)
  ].slice(-6) : [];
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
  const scene = activeScene(state);
  const category = kind === "character sheet" ? "Karakterer" : kind === "location map" ? "Locations" : scene ? `Scene: ${scene.title} / Work` : "Genererede billeder";
  const outputDirectory = kind === "character sheet" ? characterDir() : kind === "location map" ? locationDir() : scene ? sceneWorkDir(scene) : assetDir();
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
  const higgsSession = session.fromPartition("persist:higgsfield");
  higgsSession.on("will-download", (_event, item) => {
    const state = loadState();
    const scene = activeScene(state);
    const destinationDirectory = scene ? sceneWorkDir(scene) : assetDir();
    fs.mkdirSync(destinationDirectory, {recursive:true});
    item.setSavePath(uniqueDestination(destinationDirectory, item.getFilename()));
    item.once("done", (_doneEvent, status) => {
      if (status === "completed") mainWindow?.webContents.send("continuity:changed", continuitySnapshot());
    });
  });
  checkForUpdates = setupUpdater({getSettings:loadState, notify:message => mainWindow?.webContents.send("update:status", message)});
  ipcMain.handle("state:get", () => { const s = loadState(); return {...s, encryptedApiKey:undefined, hasApiKey:Boolean(getApiKey(s)), imports:s.imports.map(({path:_p,...x})=>x), workflows:HIGGSFIELD_WORKFLOWS}; });
  ipcMain.handle("settings:save", (_e, {apiKey, model, autoUpdate, updateFeedUrl}) => { const s=loadState(); if(apiKey) s.encryptedApiKey=safeStorage.encryptString(apiKey).toString("base64"); if(model) s.model=model; if(typeof autoUpdate==="boolean") s.autoUpdate=autoUpdate; if(typeof updateFeedUrl==="string") s.updateFeedUrl=updateFeedUrl.trim(); saveState(s); return {ok:true, hasApiKey:Boolean(getApiKey(s))}; });
  ipcMain.handle("onboarding:complete", (_e, name) => { const s=loadState(); if(String(name||"").trim()) s.currentUserName=String(name).trim(); if(!s.deviceId) s.deviceId=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`; s.onboardingCompleted=true; saveState(s); return {ok:true}; });
  ipcMain.handle("team:get", () => teamSnapshot());
  ipcMain.handle("team:profile", (_e, name) => saveTeamProfile(name));
  ipcMain.handle("team:send", (_e, text) => sendTeamMessage(text));
  ipcMain.handle("team:attach", () => attachTeamFiles());
  ipcMain.handle("team:open-attachments", () => openTeamAttachments());
  ipcMain.handle("assistant:run", (_e, text, engine) => runAssistant(text, engine));
  ipcMain.handle("project:import", () => importFiles());
  ipcMain.handle("project:remove", (_e, id) => { const s=loadState(); const item=s.imports.find(x=>x.id===id); if(item) fs.unlink(item.path,()=>{}); s.imports=s.imports.filter(x=>x.id!==id); saveState(s); return s.imports.map(({path:_p,...x})=>x); });
  ipcMain.handle("voice:transcribe", (_e, data, mime) => transcribeAudio(data, mime));
  ipcMain.handle("image:create", (_e, request) => createReferenceImage(request));
  ipcMain.handle("higgs:navigate", async (_e, url) => { await higgsView.webContents.loadURL(url); return true; });
  ipcMain.handle("update:check", () => checkForUpdates?.());
  ipcMain.handle("project:open-folder", () => shell.openPath(masterDir()));
  ipcMain.handle("knowledge:get", () => aiKnowledgeSnapshot());
  ipcMain.handle("knowledge:import", (_e, sourceType) => importAiKnowledge(sourceType));
  ipcMain.handle("knowledge:save-text", (_e, payload) => saveAiKnowledgeText(payload));
  ipcMain.handle("knowledge:remove", (_e, id) => removeAiKnowledge(id));
  ipcMain.handle("continuity:get", () => continuitySnapshot());
  ipcMain.handle("scene:create", (_e, title) => createScene(title));
  ipcMain.handle("scene:activate", (_e, id) => {
    const state = loadState();
    if (!state.scenes.some(scene => scene.id === id)) throw new Error("Scenen kunne ikke findes.");
    state.activeSceneId = id;
    saveState(state);
    return continuitySnapshot();
  });
  ipcMain.handle("continuity:import", (_e, category) => importContinuityFiles(category));
  ipcMain.handle("scene:add-elements", (_e, ids) => addElementsToScene(ids));
  ipcMain.handle("scene:move-final", (_e, filename) => moveWorkToFinal(filename));
  ipcMain.handle("scene:set-private", (_e, value) => setScenePrivate(value));
  ipcMain.handle("asset:set-private", (_e, payload) => setAssetPrivate(payload));
  ipcMain.handle("editor:choose-folder", () => chooseEditorDeliveryFolder());
  ipcMain.handle("editor:deliver", (_e, filename) => deliverFinalToEditor(filename));
  ipcMain.handle("editor:open-folder", () => openEditorDeliveryFolder());
  ipcMain.handle("scene:open-folder", () => {
    const scene = activeScene();
    return shell.openPath(scene ? sceneDir(scene) : scenesDir());
  });
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
