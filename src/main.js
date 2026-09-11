const { app, BrowserWindow, WebContentsView, ipcMain, dialog, safeStorage, session, nativeImage, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const OpenAI = require("openai");
const { toFile } = require("openai");
const pdf = require("pdf-parse");
const { KESSLER_PROFILE, HIGGSFIELD_WORKFLOWS, buildSystemPrompt } = require("./knowledge");
const { ENGINE_CATALOG, normalizeBible, readiness, buildBibleText } = require("./production-bible");
const { setupUpdater, stopUpdater } = require("./updater");

let mainWindow;
let higgsView;
let higgsWindow;
let pendingApproval = null;
let creditApprovalBudget = 0;
let checkForUpdates;
let workspaceRootOverride = "";

const statePath = () => path.join(app.getPath("userData"), "state.json");
const legacyAssetDir = () => path.join(app.getPath("userData"), "project-assets");
const defaultWorkspaceRoot = () => path.join(app.getPath("movies"), "Brightside Film Remote");
const workspaceRoot = () => workspaceRootOverride || defaultWorkspaceRoot();
const masterDir = () => path.join(workspaceRoot(), "KESSLER");
const projectDir = () => path.join(masterDir(), "00-PROJEKT");
const referenceArchiveDir = () => path.join(masterDir(), "01-REFERENCER");
const referenceImagesDir = () => path.join(referenceArchiveDir(), "Billeder");
const referenceFilmsDir = () => path.join(referenceArchiveDir(), "Film");
const renderArchiveDir = () => path.join(masterDir(), "04-RENDERINGER-USORTERET");
const assetDir = () => path.join(renderArchiveDir(), "Billeder");
const renderFilmDir = () => path.join(renderArchiveDir(), "Film");
const importedDir = () => path.join(referenceArchiveDir(), "Dokumenter-og-lookbooks");
const promptDir = () => path.join(projectDir(), "Prompts");
const elementsDir = () => path.join(masterDir(), "02-ELEMENTER");
const characterDir = () => path.join(elementsDir(), "Karakterer");
const locationDir = () => path.join(elementsDir(), "Locations");
const scenesDir = () => path.join(masterDir(), "03-SCENER");
const aiKnowledgeDir = () => path.join(referenceArchiveDir(), "AI-viden");
const sceneDir = scene => path.join(scenesDir(), scene.folder);
const sceneRefsDir = scene => path.join(sceneDir(scene), "01-REFERENCER");
const sceneRefImagesDir = scene => path.join(sceneRefsDir(scene), "Billeder");
const sceneRefFilmsDir = scene => path.join(sceneRefsDir(scene), "Film");
const sceneWorkDir = scene => path.join(sceneDir(scene), "02-WORK");
const sceneFinalDir = scene => path.join(sceneDir(scene), "03-FINAL");
const deliveryDir = () => path.join(masterDir(), "05-LEVERINGER");
const localEditorDeliveryDir = () => path.join(deliveryDir(), "Godkendt til Allan");
const productionDir = () => path.join(masterDir(), "06-PRODUKTION");
const productionPlanPath = () => path.join(productionDir(), "KESSLER-arbejdsplan.json");
const productionBibleDir = () => path.join(projectDir(), "Production Bible");
const screenplayDir = () => path.join(projectDir(), "Manus");
const productionBibleJsonPath = () => path.join(productionBibleDir(), "KESSLER-production-bible.json");
const productionBibleTextPath = () => path.join(productionBibleDir(), "KESSLER-production-bible.md");
const STATE_SCHEMA_VERSION = 2;

function unclassifiedRenderDir(filename) {
  return /\.(mp4|mov|m4v|mkv|webm)$/i.test(String(filename || "")) ? renderFilmDir() : assetDir();
}

function atomicWriteFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), {recursive:true});
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, content);
  fs.renameSync(tempPath, filePath);
}

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

function copyTreePreserving(source, destination) {
  if (!fs.existsSync(source) || path.resolve(source) === path.resolve(destination)) return;
  fs.mkdirSync(destination, {recursive:true});
  for (const entry of fs.readdirSync(source, {withFileTypes:true})) {
    if (entry.name.startsWith(".")) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTreePreserving(from, to);
    else if (!fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

function remapStoredPath(filePath, mappings) {
  if (!filePath) return filePath;
  const resolved = path.resolve(filePath);
  for (const [source, destination] of mappings) {
    const sourceRoot = path.resolve(source);
    if (resolved === sourceRoot || resolved.startsWith(sourceRoot + path.sep)) {
      return path.join(destination, path.relative(sourceRoot, resolved));
    }
  }
  return filePath;
}

function legacyArchiveMappings(state) {
  const root = masterDir();
  const mappings = [
    [path.join(root, "Genererede billeder"), assetDir()],
    [path.join(root, "Importerede referencer"), importedDir()],
    [path.join(root, "Prompts"), promptDir()],
    [path.join(root, "Elementer"), elementsDir()],
    [path.join(root, "AI-viden"), aiKnowledgeDir()],
    [path.join(root, "Godkendt til Allan"), localEditorDeliveryDir()],
    [path.join(root, "Produktion"), productionDir()],
    [path.join(root, "Production Bible"), productionBibleDir()]
  ];
  for (const scene of state.scenes || []) {
    const oldScene = path.join(root, "Scener", scene.folder);
    mappings.push(
      [path.join(oldScene, "Referencer"), sceneRefsDir(scene)],
      [path.join(oldScene, "Work"), sceneWorkDir(scene)],
      [path.join(oldScene, "Final"), sceneFinalDir(scene)]
    );
  }
  return mappings;
}

function archiveGuide() {
  return [
    "BRIGHTSIDE FILM REMOTE · KESSLER-ARKIV",
    "",
    "00-PROJEKT",
    "  Project Bible, manus, prompts og projektets overordnede viden.",
    "",
    "01-REFERENCER",
    "  Originale referencebilleder, referencefilm, lookbooks, dokumenter og AI-viden.",
    "",
    "02-ELEMENTER",
    "  Genbrugelige karakterark og locations, der låser kontinuiteten.",
    "",
    "03-SCENER",
    "  Én nummereret mappe pr. scene:",
    "  01-REFERENCER = input og virkelige referencer",
    "  02-WORK       = prompts og igangværende renderinger",
    "  03-FINAL      = godkendte billeder og film",
    "",
    "04-RENDERINGER-USORTERET",
    "  Renderinger hentet uden en aktiv scene. Sortér dem senere ind i en scene.",
    "",
    "05-LEVERINGER",
    "  Godkendte masterfiler og materiale til Allan.",
    "",
    "06-PRODUKTION",
    "  Arbejdsplan, ansvar, status og deadlines.",
    "",
    "Projektstandard: CinemaScope 2.39:1 · 25 fps",
    ""
  ].join("\n");
}

function ensureSceneFolders(scene) {
  [sceneDir(scene), sceneRefsDir(scene), sceneRefImagesDir(scene), sceneRefFilmsDir(scene), sceneWorkDir(scene), sceneFinalDir(scene)]
    .forEach(directory => fs.mkdirSync(directory, {recursive:true}));
}

function ensureMasterFolder() {
  const state = loadState();
  const mappings = legacyArchiveMappings(state);
  mappings.forEach(([source, destination]) => copyTreePreserving(source, destination));
  [masterDir(), projectDir(), referenceArchiveDir(), referenceImagesDir(), referenceFilmsDir(), renderArchiveDir(), assetDir(), renderFilmDir(), importedDir(), promptDir(), elementsDir(), characterDir(), locationDir(), scenesDir(), aiKnowledgeDir(), deliveryDir(), localEditorDeliveryDir(), productionDir(), productionBibleDir(), screenplayDir()]
    .forEach(directory => fs.mkdirSync(directory, { recursive: true }));
  copyLegacyElements(path.join(masterDir(), "Character sheets"), characterDir());
  copyLegacyElements(path.join(masterDir(), "Location maps"), locationDir());
  atomicWriteFile(path.join(masterDir(), "START-HER · ARKIV-OVERSIGT.txt"), archiveGuide());
  const profilePath = path.join(masterDir(), "KESSLER-profil.json");
  if (!fs.existsSync(profilePath)) fs.writeFileSync(profilePath, JSON.stringify(KESSLER_PROFILE, null, 2));

  state.scenes.forEach(ensureSceneFolders);
  let changed = false;
  for (const collection of [state.imports, state.aiKnowledge, state.screenplays, state.editorDeliveries]) {
    for (const item of collection || []) {
      for (const key of ["path", "destination"]) {
        const updated = remapStoredPath(item[key], mappings);
        if (updated !== item[key]) { item[key] = updated; changed = true; }
      }
    }
  }
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
  return { schemaVersion:STATE_SCHEMA_VERSION, workspaceRoot:"", workspaceConfigured:false, project:KESSLER_PROFILE, projectMeta:{logline:"",tone:"Rå dansk bokse-realisme"}, styleLocks:{visualStyle:"",cameraLens:"",characterContinuity:"",locationLighting:"",exclusions:""}, screenplays:[], shots:[], takeRatings:{}, sceneBindings:[], imports:[], aiKnowledge:[], scenes:[], activeSceneId:null, currentUserRole:"admin", currentUserName:"Nicolas", onboardingCompleted:false, productionPlan:[], editorName:"Allan", editorDeliveryDir:"", editorDeliveries:[], privateAssets:{}, model:"gpt-5.6-terra", encryptedApiKey:null, conversation:[], autoUpdate:true, updateFeedUrl:"" };
}

function normalizeLoadedState(parsed) {
    const state = {...initialState(), ...parsed};
    if (!Array.isArray(state.imports)) state.imports = [];
    if (!Array.isArray(state.aiKnowledge)) state.aiKnowledge = [];
    if (!Array.isArray(state.screenplays)) state.screenplays = [];
    if (!Array.isArray(state.scenes)) state.scenes = [];
    if (!Array.isArray(state.editorDeliveries)) state.editorDeliveries = [];
    if (!Array.isArray(state.productionPlan)) state.productionPlan = [];
    if (!state.privateAssets || typeof state.privateAssets !== "object") state.privateAssets = {};
    state.currentUserRole = "admin";
    state.currentUserName = "Nicolas";
    workspaceRootOverride = String(state.workspaceRoot || "").trim() || defaultWorkspaceRoot();
    state.workspaceRoot = workspaceRootOverride;
    state.workspaceConfigured = state.workspaceConfigured === true;
    state.schemaVersion = STATE_SCHEMA_VERSION;
    normalizeBible(state);
    return state;
}

function loadState() {
  try { return normalizeLoadedState(JSON.parse(fs.readFileSync(statePath(), "utf8"))); }
  catch {
    try { return normalizeLoadedState(JSON.parse(fs.readFileSync(`${statePath()}.backup`, "utf8"))); }
    catch { return initialState(); }
  }
}

function saveState(next) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  next.schemaVersion = STATE_SCHEMA_VERSION;
  normalizeBible(next);
  const destination = statePath();
  if (fs.existsSync(destination)) {
    try { fs.copyFileSync(destination, `${destination}.backup`); } catch {}
  }
  atomicWriteFile(destination, JSON.stringify(next, null, 2));
}

function workspaceSnapshot(state = loadState()) {
  return {
    configured: state.workspaceConfigured === true,
    workspaceRoot: state.workspaceRoot || workspaceRoot(),
    projectRoot: masterDir(),
    folders: [
      "00-PROJEKT",
      "01-REFERENCER",
      "02-ELEMENTER",
      "03-SCENER",
      "04-RENDERINGER-USORTERET",
      "05-LEVERINGER",
      "06-PRODUKTION"
    ]
  };
}

async function chooseWorkspace() {
  const state = loadState();
  const oldWorkspace = workspaceRoot();
  const oldMaster = path.join(oldWorkspace, "KESSLER");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Vælg lokalt arbejdsområde til Brightside Film Remote",
    defaultPath: state.workspaceRoot || defaultWorkspaceRoot(),
    buttonLabel: "Brug denne mappe",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return {ok:false, ...workspaceSnapshot(state)};

  const selected = path.resolve(result.filePaths[0]);
  const newMaster = path.join(selected, "KESSLER");
  if (newMaster.startsWith(path.resolve(oldMaster) + path.sep)) {
    throw new Error("Vælg en mappe uden for den nuværende KESSLER-mappe.");
  }
  fs.mkdirSync(selected, {recursive:true});
  fs.accessSync(selected, fs.constants.R_OK | fs.constants.W_OK);

  if (path.resolve(oldMaster) !== path.resolve(newMaster) && fs.existsSync(oldMaster)) {
    copyTreePreserving(oldMaster, newMaster);
    const rootMapping = [[oldMaster, newMaster]];
    for (const collection of [state.imports, state.aiKnowledge, state.screenplays, state.editorDeliveries]) {
      for (const item of collection || []) {
        for (const key of ["path", "destination"]) item[key] = remapStoredPath(item[key], rootMapping);
      }
    }
    state.editorDeliveryDir = remapStoredPath(state.editorDeliveryDir, rootMapping);
  }

  state.workspaceRoot = selected;
  state.workspaceConfigured = true;
  workspaceRootOverride = selected;
  saveState(state);
  ensureMasterFolder();
  return {ok:true, ...workspaceSnapshot(loadState())};
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

function listReferenceMedia(scene,state) {
  const decorate=(items,kind)=>items.map(item=>({...item,kind,binding:state.sceneBindings.find(binding=>binding.sceneId===scene.id&&binding.sceneFile===item.name)||null,isAnchor:scene.anchorFrame===`${kind}/${item.name}`}));
  const legacy=decorate(listAssets(sceneRefsDir(scene),"reference"),"reference");
  return {
    images:[...legacy.filter(item=>/\.(jpe?g|png|webp)$/i.test(item.name)),...decorate(listAssets(sceneRefImagesDir(scene),"reference-image"),"image")],
    films:decorate(listAssets(sceneRefFilmsDir(scene),"reference-film"),"film"),
    documents:legacy.filter(item=>!/\.(jpe?g|png|webp)$/i.test(item.name))
  };
}

function activeScene(state = loadState()) {
  return state.scenes.find(scene => scene.id === state.activeSceneId) || null;
}

function continuitySnapshot() {
  const state = loadState();
  const scene = activeScene(state);
  if (scene) ensureSceneFolders(scene);
  const media=scene?listReferenceMedia(scene,state):{images:[],films:[],documents:[]};
  return {
    scenes: state.scenes.map(item => ({id:item.id, title:item.title, folder:item.folder, privateOnly:Boolean(item.privateOnly), anchorFrame:item.anchorFrame||"", active:item.id === state.activeSceneId})),
    activeSceneId: state.activeSceneId,
    currentUserRole: "admin",
    characters: listAssets(characterDir(), "character"),
    locations: listAssets(locationDir(), "location"),
    references:[...media.images,...media.documents],
    referenceImages:media.images,
    referenceFilms:media.films,
    referenceDocuments:media.documents,
    work: scene ? listAssets(sceneWorkDir(scene), "work").map(item => ({...item, privateOnly:Boolean(state.privateAssets[`${scene.id}:work:${item.name}`]),rating:state.takeRatings[`${scene.id}:work:${item.name}`]||"none",isAnchor:scene.anchorFrame===`work/${item.name}`})) : [],
    final: scene ? listAssets(sceneFinalDir(scene), "final").map(item => ({...item, privateOnly:Boolean(state.privateAssets[`${scene.id}:final:${item.name}`]),rating:state.takeRatings[`${scene.id}:final:${item.name}`]||"none",isAnchor:scene.anchorFrame===`final/${item.name}`})) : [],
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
  persistProductionBible(state);
  return continuitySnapshot();
}

async function importContinuityFiles(category) {
  const state = loadState();
  const scene = activeScene(state);
  const destinations = {character:characterDir(), location:locationDir(), scene:scene && sceneRefsDir(scene), background:scene && sceneRefsDir(scene)};
  const destinationDirectory = destinations[category];
  if (!destinationDirectory) throw new Error("Opret eller vælg først en scene.");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: category === "character" ? "Tilføj karakterer" : category === "location" ? "Tilføj locations" : category === "background" ? "Tilføj rent baggrundslag" : "Tilføj referencer til scenen",
    properties:["openFile","multiSelections"],
    filters:[{name:"Billeder, PDF og noter", extensions:["pdf","txt","md","jpg","jpeg","png","webp"]}]
  });
  if (result.canceled) return continuitySnapshot();
  fs.mkdirSync(destinationDirectory, {recursive:true});
  for (const source of result.filePaths) {
    const destination = uniqueDestination(destinationDirectory, path.basename(source));
    fs.copyFileSync(source, destination);
    if(scene && ["scene","background"].includes(category)) state.sceneBindings.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,sceneId:scene.id,type:category==="background"?"background":"reference",sourceName:path.basename(source),sceneFile:path.basename(destination),locked:category==="background",createdAt:new Date().toISOString()});
  }
  if(scene && ["scene","background"].includes(category)) { saveState(state); persistProductionBible(state); }
  return continuitySnapshot();
}

async function importSceneReferenceMedia(kind) {
  const state=loadState(),scene=activeScene(state);if(!scene)throw new Error("Opret eller vælg først en scene.");
  const isFilm=kind==="film",destinationDirectory=isFilm?sceneRefFilmsDir(scene):sceneRefImagesDir(scene);
  const result=await dialog.showOpenDialog(mainWindow,{title:isFilm?"Upload referencefilm til aktiv scene":"Upload referencebilleder til aktiv scene",properties:["openFile","multiSelections"],filters:[isFilm?{name:"Referencefilm",extensions:["mp4","mov","m4v","mkv","webm"]}:{name:"Referencebilleder",extensions:["jpg","jpeg","png","webp","tif","tiff"]}]});
  if(result.canceled)return continuitySnapshot();
  fs.mkdirSync(destinationDirectory,{recursive:true});
  for(const source of result.filePaths){const destination=uniqueDestination(destinationDirectory,path.basename(source));fs.copyFileSync(source,destination);state.sceneBindings.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,sceneId:scene.id,type:isFilm?"reference-film":"reference-image",sourceName:path.basename(source),sceneFile:path.basename(destination),locked:true,createdAt:new Date().toISOString()});}
  saveState(state);persistProductionBible(state);return continuitySnapshot();
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
    state.sceneBindings.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,sceneId:scene.id,elementId:id,type:String(id).split(":")[0],sourceName:path.basename(source),sceneFile:path.basename(destination),locked:true,createdAt:new Date().toISOString()});
  }
  saveState(state);persistProductionBible(state);
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
  fs.copyFileSync(source, destination);
  const finalName=path.basename(destination),workKey=`${scene.id}:work:${safeName}`,finalKey=`${scene.id}:final:${finalName}`;
  if (state.privateAssets[`${scene.id}:work:${safeName}`]) {
    state.privateAssets[finalKey] = true;
  }
  if(state.takeRatings[workKey])state.takeRatings[finalKey]=state.takeRatings[workKey];
  saveState(state);
  return continuitySnapshot();
}

function persistProductionPlan(state) {
  fs.mkdirSync(productionDir(),{recursive:true});
  atomicWriteFile(productionPlanPath(),JSON.stringify({project:"KESSLER",frameRate:25,aspectRatio:"2.39:1",updatedAt:new Date().toISOString(),items:state.productionPlan},null,2));
}
function productionSnapshot() {
  const state=loadState(),items=state.productionPlan.slice().sort((a,b)=>String(a.deadline||"9999").localeCompare(String(b.deadline||"9999")));
  return {items,currentUserRole:"admin",summary:{total:items.length,made:items.filter(x=>x.made).length,approved:items.filter(x=>x.approved).length,delivered:items.filter(x=>x.delivered).length}};
}
function normalizeHeader(value){return String(value||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"");}
function parseDelimited(text,delimiter) {
  const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"'){quoted=!quoted;}else if(ch===delimiter&&!quoted){row.push(cell.trim());cell="";}else if((ch==="\n"||ch==="\r")&&!quoted){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell="";}else cell+=ch;}
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);return rows;
}
function decodeXml(value){return String(value||"").replace(/<[^>]+>/g,"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
function xlsxRows(filePath) {
  const list=execFileSync("/usr/bin/unzip",["-Z1",filePath],{encoding:"utf8"}).split(/\r?\n/);
  const sheet=list.find(x=>/^xl\/worksheets\/sheet1\.xml$/i.test(x))||list.find(x=>/^xl\/worksheets\/sheet\d+\.xml$/i.test(x));if(!sheet)throw new Error("Excel-filen har intet læsbart ark.");
  let shared=[];if(list.includes("xl/sharedStrings.xml")){const xml=execFileSync("/usr/bin/unzip",["-p",filePath,"xl/sharedStrings.xml"],{encoding:"utf8"});shared=[...xml.matchAll(/<si[\s\S]*?<\/si>/g)].map(m=>decodeXml(m[0]));}
  const xml=execFileSync("/usr/bin/unzip",["-p",filePath,sheet],{encoding:"utf8"}),rows=[];
  for(const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)){const values=[];for(const cm of rm[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)){const attrs=cm[1],body=cm[2],ref=(attrs.match(/r="([A-Z]+)\d+"/)||[])[1]||"A";let col=0;for(const ch of ref)col=col*26+ch.charCodeAt(0)-64;col--;const raw=(body.match(/<v[^>]*>([\s\S]*?)<\/v>/)||body.match(/<t[^>]*>([\s\S]*?)<\/t>/)||[])[1]||"";values[col]=/t="s"/.test(attrs)?shared[Number(raw)]||"":decodeXml(raw);}if(values.some(Boolean))rows.push(values);}
  return rows;
}
function normalizeDeadline(value){const raw=String(value||"").trim();if(/^\d{5}(\.\d+)?$/.test(raw)){const date=new Date((Number(raw)-25569)*86400000);return Number.isNaN(date.getTime())?raw:date.toISOString().slice(0,16);}return raw;}
function rowsToPlan(rows) {
  if(rows.length<2)return[];const headers=rows[0].map(normalizeHeader);
  const find=(names)=>headers.findIndex(h=>names.includes(h));
  const ix={title:find(["titel","title","generation","generering","element","opgave","shot"]),scene:find(["scene","scenenummer","scenenavn"]),assignedTo:find(["ansvarlig","person","hvem","assignedto","owner","artist"]),engine:find(["engine","motor","workflow","model"]),deadline:find(["deadline","levering","leveringsdato","dato","duedate"]),status:find(["status"]),notes:find(["noter","note","beskrivelse","description"])};
  return rows.slice(1).filter(r=>r.some(Boolean)).map(r=>{const status=String(ix.status>=0?r[ix.status]||"":"").toLowerCase();return{id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,title:String(r[ix.title]||r[0]||"Nyt element"),scene:String(ix.scene>=0?r[ix.scene]||"":""),assignedTo:String(ix.assignedTo>=0?r[ix.assignedTo]||"":""),engine:String(ix.engine>=0?r[ix.engine]||"":""),deadline:normalizeDeadline(ix.deadline>=0?r[ix.deadline]||"":""),notes:String(ix.notes>=0?r[ix.notes]||"":""),made:/lavet|done|færdig/.test(status),approved:/godkendt|approved/.test(status),delivered:/leveret|sendt|delivered/.test(status),privateOnly:false,createdAt:new Date().toISOString()};});
}
async function importProductionPlan() {
  const result=await dialog.showOpenDialog(mainWindow,{title:"Importér KESSLER-arbejdsplan",properties:["openFile"],filters:[{name:"Arbejdsplan",extensions:["xlsx","csv","tsv","json"]}]});if(result.canceled)return productionSnapshot();
  const file=result.filePaths[0],ext=path.extname(file).toLowerCase();let rows=[];
  if(ext===".xlsx")rows=xlsxRows(file);else if(ext===".json"){const parsed=JSON.parse(fs.readFileSync(file,"utf8"));const source=Array.isArray(parsed)?parsed:(parsed.items||[]);rows=[["Titel","Scene","Ansvarlig","Engine","Deadline","Status","Noter"],...source.map(x=>[x.title||x.titel,x.scene,x.assignedTo||x.ansvarlig,x.engine,x.deadline,x.status||((x.delivered&&"Leveret")||(x.approved&&"Godkendt")||(x.made&&"Lavet")||""),x.notes||x.noter])];}else{const text=fs.readFileSync(file,"utf8"),delimiter=ext===".tsv"?"\t":((text.split("\n")[0].match(/;/g)||[]).length>(text.split("\n")[0].match(/,/g)||[]).length?";":",");rows=parseDelimited(text,delimiter);}
  const imported=rowsToPlan(rows);const state=loadState();state.productionPlan.push(...imported);saveState(state);persistProductionPlan(state);return productionSnapshot();
}
function createProductionItem(payload) {
  const state=loadState(),title=String(payload?.title||"").trim();if(!title)throw new Error("Skriv et navn til elementet.");
  state.productionPlan.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,title,scene:String(payload.scene||""),assignedTo:String(payload.assignedTo||""),engine:String(payload.engine||""),deadline:String(payload.deadline||""),notes:String(payload.notes||""),made:false,approved:false,delivered:false,privateOnly:Boolean(payload.privateOnly),createdAt:new Date().toISOString()});saveState(state);persistProductionPlan(state);return productionSnapshot();
}
function updateProductionItem({id,field,value}) {
  const allowed=["title","scene","assignedTo","engine","deadline","notes","made","approved","delivered","privateOnly"];if(!allowed.includes(field))throw new Error("Ugyldigt felt.");
  const state=loadState();if(field==="privateOnly")assertAdmin(state);const item=state.productionPlan.find(x=>x.id===id);if(!item)throw new Error("Elementet findes ikke.");item[field]=["made","approved","delivered","privateOnly"].includes(field)?Boolean(value):String(value||"");item.updatedAt=new Date().toISOString();saveState(state);persistProductionPlan(state);return productionSnapshot();
}
function removeProductionItem(id){const state=loadState();assertAdmin(state);state.productionPlan=state.productionPlan.filter(x=>x.id!==id);saveState(state);persistProductionPlan(state);return productionSnapshot();}
function openProductionFolder(){fs.mkdirSync(productionDir(),{recursive:true});return shell.openPath(productionDir());}

function screenplaySnapshot() {
  const state = loadState();
  return (state.screenplays || []).map(item => ({
    id:item.id,
    name:item.name,
    active:item.active !== false,
    importedAt:item.importedAt,
    characters:Number(item.characters || String(item.summary || "").length)
  })).reverse();
}

async function extractScreenplayText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    const parsed = await pdf(fs.readFileSync(filePath));
    return parsed.text.replace(/\s+\n/g, "\n").trim().slice(0, 180000);
  }
  if (ext === ".docx") {
    const xml = execFileSync("/usr/bin/unzip", ["-p", filePath, "word/document.xml"], {encoding:"utf8", maxBuffer:50 * 1024 * 1024});
    return decodeXml(xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t")).replace(/\n{3,}/g, "\n\n").trim().slice(0, 180000);
  }
  if (ext === ".fdx") {
    const xml = fs.readFileSync(filePath, "utf8");
    return decodeXml(xml.replace(/<\/Paragraph>/g, "\n").replace(/<\/Text>/g, " ")).replace(/\n{3,}/g, "\n\n").trim().slice(0, 180000);
  }
  return fs.readFileSync(filePath, "utf8").trim().slice(0, 180000);
}

async function importScreenplay() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:"Upload manus til KESSLER Project Bible",
    properties:["openFile"],
    filters:[{name:"Manus", extensions:["pdf","docx","fdx","txt","md"]}]
  });
  if (result.canceled || !result.filePaths[0]) return screenplaySnapshot();
  const source = result.filePaths[0];
  fs.mkdirSync(screenplayDir(), {recursive:true});
  const destination = uniqueDestination(screenplayDir(), path.basename(source));
  fs.copyFileSync(source, destination);
  const summary = await extractScreenplayText(destination);
  if (!summary.trim()) throw new Error("Manuskriptet indeholder ingen læsbar tekst.");
  const state = loadState();
  state.screenplays.forEach(item => { item.active = false; });
  state.screenplays.push({
    id:Date.now() + "-" + Math.random().toString(36).slice(2,8),
    name:path.basename(source),
    path:destination,
    summary,
    characters:summary.length,
    active:true,
    importedAt:new Date().toISOString()
  });
  saveState(state);
  return screenplaySnapshot();
}

function removeScreenplay(id) {
  const state = loadState();
  const item = state.screenplays.find(entry => entry.id === id);
  if (item?.path && item.path.startsWith(screenplayDir()) && fs.existsSync(item.path)) fs.unlinkSync(item.path);
  state.screenplays = state.screenplays.filter(entry => entry.id !== id);
  if (state.screenplays.length && !state.screenplays.some(entry => entry.active !== false)) state.screenplays[state.screenplays.length - 1].active = true;
  saveState(state);
  return screenplaySnapshot();
}

function persistProductionBible(state) {
  normalizeBible(state);
  const active = activeScene(state);
  const payload = {
    schemaVersion:1,
    project:"KESSLER",
    aspectRatio:"2.39:1",
    frameRate:25,
    updatedAt:new Date().toISOString(),
    projectMeta:state.projectMeta,
    styleLocks:state.styleLocks,
    scenes:state.scenes,
    shots:state.shots,
    sceneBindings:state.sceneBindings,
    screenplays:state.screenplays.map(item => ({name:item.name,active:item.active !== false,importedAt:item.importedAt})),
    activeSceneId:state.activeSceneId,
    activeScene:active ? {id:active.id,title:active.title,folder:active.folder,anchorFrame:active.anchorFrame||""} : null
  };
  atomicWriteFile(productionBibleJsonPath(), JSON.stringify(payload,null,2));
  atomicWriteFile(productionBibleTextPath(), buildBibleText(state));
}

function bibleSnapshot() {
  const state=loadState(),scene=activeScene(state);
  return {
    projectMeta:state.projectMeta,
    styleLocks:state.styleLocks,
    engines:ENGINE_CATALOG,
    readiness:readiness(state),
    activeScene:scene ? {id:scene.id,title:scene.title,folder:scene.folder,anchorFrame:scene.anchorFrame||""} : null,
    shots:scene ? state.shots.filter(shot=>shot.sceneId===scene.id).sort((a,b)=>String(a.code).localeCompare(String(b.code),"da",{numeric:true})) : []
  };
}

function updateBible(payload={}) {
  const state=loadState();
  for(const key of ["logline","tone"]) if(key in payload) state.projectMeta[key]=String(payload[key]||"").slice(0,4000);
  for(const key of ["visualStyle","cameraLens","characterContinuity","locationLighting","exclusions"]) if(key in payload) state.styleLocks[key]=String(payload[key]||"").slice(0,8000);
  saveState(state);persistProductionBible(state);return bibleSnapshot();
}

function createShot(payload={}) {
  const state=loadState(),scene=activeScene(state);if(!scene)throw new Error("Opret eller vælg først en scene.");
  const title=String(payload.title||"").trim();if(!title)throw new Error("Skriv et navn til shottet.");
  const count=state.shots.filter(shot=>shot.sceneId===scene.id).length+1;
  state.shots.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,sceneId:scene.id,code:String(payload.code||`SH${String(count).padStart(3,"0")}`).toUpperCase().slice(0,30),title:title.slice(0,200),engine:String(payload.engine||"auto"),status:"planlagt",prompt:String(payload.prompt||"").slice(0,16000),createdAt:new Date().toISOString()});
  saveState(state);persistProductionBible(state);return bibleSnapshot();
}

function updateShot({id,field,value}={}) {
  const allowed=["code","title","engine","status","prompt"];if(!allowed.includes(field))throw new Error("Ugyldigt shot-felt.");
  const state=loadState(),shot=state.shots.find(item=>item.id===id);if(!shot)throw new Error("Shottet findes ikke.");
  shot[field]=String(value||"").slice(0,field==="prompt"?16000:400);shot.updatedAt=new Date().toISOString();
  saveState(state);persistProductionBible(state);return bibleSnapshot();
}

function removeShot(id) {
  const state=loadState();state.shots=state.shots.filter(item=>item.id!==id);saveState(state);persistProductionBible(state);return bibleSnapshot();
}

function setTakeRating({category,filename,rating}={}) {
  const state=loadState(),scene=activeScene(state);if(!scene)throw new Error("Vælg først en scene.");
  if(!["work","final"].includes(category)||!["none","red","yellow","green"].includes(rating))throw new Error("Ugyldig take-vurdering.");
  const safeName=path.basename(String(filename||"")),directory=category==="work"?sceneWorkDir(scene):sceneFinalDir(scene);
  if(!safeName||!fs.existsSync(path.join(directory,safeName)))throw new Error("Filen kunne ikke findes.");
  const key=`${scene.id}:${category}:${safeName}`;if(rating==="none")delete state.takeRatings[key];else state.takeRatings[key]=rating;
  saveState(state);return continuitySnapshot();
}

function setSceneAnchor({category,filename}={}) {
  const state=loadState(),scene=activeScene(state);if(!scene)throw new Error("Vælg først en scene.");
  if(!["reference","image","work","final"].includes(category))throw new Error("Ugyldig anchor-kilde.");
  const safeName=path.basename(String(filename||""));
  const directory=category==="reference"?sceneRefsDir(scene):category==="image"?sceneRefImagesDir(scene):category==="work"?sceneWorkDir(scene):sceneFinalDir(scene);
  if(!safeName||!fs.existsSync(path.join(directory,safeName)))throw new Error("Anchor-filen kunne ikke findes.");
  scene.anchorFrame=`${category}/${safeName}`;saveState(state);persistProductionBible(state);return continuitySnapshot();
}

function openProductionBibleFolder(){fs.mkdirSync(productionBibleDir(),{recursive:true});return shell.openPath(productionBibleDir());}
function openExternalEngine(id) {
  const engine=ENGINE_CATALOG.find(item=>item.id===id&&item.status==="external"&&item.url);
  if(!engine)throw new Error("Denne engine åbnes direkte i Brightside eller Higgsfield.");
  return shell.openExternal(engine.url);
}

function assertAdmin(state) {
  if (state.currentUserRole !== "admin") throw new Error("Kun Nicolas/Admin kan ændre privatstatus.");
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
  let version=state.editorDeliveries.filter(item=>item.sceneId===scene.id&&item.sourceName===safeName).reduce((max,item)=>Math.max(max,Number(item.version)||0),0)+1;
  let masterName=editorMasterName(scene,safeName,version),destination=path.join(destinationDir,masterName);
  while(fs.existsSync(destination)){version+=1;masterName=editorMasterName(scene,safeName,version);destination=path.join(destinationDir,masterName);}
  fs.copyFileSync(source,destination); state.editorDeliveries.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,sceneId:scene.id,sceneTitle:scene.title,sceneFolder:scene.folder,sourceName:safeName,masterName,version,approvedFor:state.editorName||"Allan",approvedAt:new Date().toISOString(),destination}); saveState(state);
  const deliveries=state.editorDeliveries.filter(item=>item.sceneId===scene.id).map(({destination:_p,...item})=>item);
  atomicWriteFile(path.join(destinationDir,"BRIGHTSIDE-delivery-manifest.json"),JSON.stringify({project:"KESSLER",frameRate:25,aspectRatio:"2.39:1",scene:{id:scene.id,title:scene.title,folder:scene.folder},deliveries},null,2));
  return continuitySnapshot();
}
function openEditorDeliveryFolder() {
  const state=loadState(),directory=state.editorDeliveryDir||localEditorDeliveryDir(); fs.mkdirSync(directory,{recursive:true}); return shell.openPath(directory);
}

function activeSceneReferencePaths(state) {
  const scene = activeScene(state);
  if (!scene || !fs.existsSync(sceneRefsDir(scene))) return [];
  return [sceneRefsDir(scene),sceneRefImagesDir(scene)].flatMap(directory=>fs.readdirSync(directory,{withFileTypes:true})
    .filter(entry => entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name))
    .map(entry => path.join(directory, entry.name)));
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
  if (!higgsWindow || higgsWindow.isDestroyed() || !higgsView) return;
  const [width, height] = higgsWindow.getContentSize();
  higgsView.setBounds({ x: 0, y: 0, width, height });
}

function openHiggsfield() {
  if (!higgsWindow || higgsWindow.isDestroyed()) {
    higgsWindow = new BrowserWindow({width:1280,height:900,minWidth:800,minHeight:600,
      title:"Higgsfield · Brightside Film Remote",backgroundColor:"#0b0b0c",
      webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
    higgsWindow.contentView.addChildView(higgsView);
    higgsWindow.on("resize", layout);
    higgsWindow.on("close", event => { event.preventDefault(); higgsWindow.hide(); });
  }
  layout();
  higgsWindow.show();
  higgsWindow.focus();
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

  higgsView.webContents.loadURL("https://higgsfield.ai/");
  higgsView.webContents.setWindowOpenHandler(({url}) => { higgsView.webContents.loadURL(url); return {action: "deny"}; });
  layout();

  higgsView.webContents.on("did-navigate", (_e, url) => mainWindow?.webContents.send("higgs:url", url));
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (higgsWindow) { higgsWindow.destroy(); higgsWindow = null; }
    higgsView?.webContents.close();
    higgsView = null;
  });
}

async function screenshotDataUrl() {
  openHiggsfield();
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
  const sceneMedia=scene?listReferenceMedia(scene,state):{images:[],films:[],documents:[]};
  const sceneReferences = [...sceneMedia.images,...sceneMedia.films,...sceneMedia.documents].map(item=>`${item.kind}: ${item.name}`).join(", ");
  const sceneBindings = scene ? state.sceneBindings.filter(item=>item.sceneId===scene.id).map(item=>`${item.type}: ${item.sceneFile}${item.locked?" (låst)":""}`).join(", ") : "";
  const externalKnowledge = state.aiKnowledge.map(item => `[${item.source.toUpperCase()} · ${item.name}]\n${item.summary || ""}`).join("\n\n").slice(-80000);
  const screenplays = state.screenplays.filter(item => item.active !== false).map(item => "[AKTIVT MANUS · " + item.name + "]\n" + (item.summary || "")).join("\n\n").slice(-120000);
  const imported = [
    screenplays ? "FILMENS MANUSKRIPT — BRUG DET TIL OVERORDNET HISTORIE, SCENER, KARAKTERER OG LOCATIONS:\n" + screenplays : "INTET MANUS UPLOADET",
    `PRODUCTION BIBLE:\n${buildBibleText(state)}`,
    `ENGINE-KONTRAKTER:\n${JSON.stringify(ENGINE_CATALOG)}`,
    scene ? `AKTIV SCENE: ${scene.title}. Kontinuitetsreferencer: ${sceneReferences || "ingen valgt endnu"}. Låste scene-elementer: ${sceneBindings || "ingen"}` : "INGEN AKTIV SCENE",
    state.imports.map(x => `${x.name}: ${x.summary || "visuel reference"}`).join("\n"),
    externalKnowledge ? `IMPORTERET AI-VIDEN FRA CLAUDE/HIGGSFIELD/ANDRE:\n${externalKnowledge}` : "INGEN IMPORTERET AI-VIDEN"
  ].join("\n").slice(0, 160000);
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
  const result = await dialog.showOpenDialog(mainWindow, {properties:["openFile","multiSelections"], filters:[{name:"Lookbooks og referencer", extensions:["pdf","txt","md","jpg","jpeg","png","webp","tif","tiff","mp4","mov","m4v","mkv","webm"]}]});
  if (result.canceled) return [];
  const state = loadState();
  [importedDir(), referenceImagesDir(), referenceFilmsDir()].forEach(directory => fs.mkdirSync(directory, {recursive:true}));
  for (const source of result.filePaths) {
    const ext = path.extname(source).toLowerCase();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const destinationDirectory = [".jpg",".jpeg",".png",".webp",".tif",".tiff"].includes(ext) ? referenceImagesDir() : [".mp4",".mov",".m4v",".mkv",".webm"].includes(ext) ? referenceFilmsDir() : importedDir();
    const destination = uniqueDestination(destinationDirectory, `${id}-${safeFilePart(path.basename(source, ext))}${ext}`);
    fs.copyFileSync(source, destination);
    let summary = "Visuel reference. Brug motiv, farve, tekstur, kostume og lys som analysegrundlag — kopiér ikke automatisk alle egenskaber.";
    if (ext === ".pdf") { const parsed = await pdf(fs.readFileSync(destination)); summary = parsed.text.slice(0, 18000); }
    if (ext === ".txt" || ext === ".md") summary = fs.readFileSync(destination, "utf8").slice(0, 18000);
    if ([".mp4",".mov",".m4v",".mkv",".webm"].includes(ext)) summary = "Referencefilm. Brug bevægelse, blocking, timing og kameraføring som analysegrundlag.";
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
    const destinationDirectory = scene ? sceneWorkDir(scene) : unclassifiedRenderDir(item.getFilename());
    fs.mkdirSync(destinationDirectory, {recursive:true});
    item.setSavePath(uniqueDestination(destinationDirectory, item.getFilename()));
    item.once("done", (_doneEvent, status) => {
      if (status === "completed") mainWindow?.webContents.send("continuity:changed", continuitySnapshot());
    });
  });
  checkForUpdates = setupUpdater({getWindow:()=>mainWindow, getSettings:loadState, notify:message => mainWindow?.webContents.send("update:status", message)});
  ipcMain.handle("state:get", () => { const s = loadState(); return {...s, encryptedApiKey:undefined, hasApiKey:Boolean(getApiKey(s)), imports:s.imports.map(({path:_p,...x})=>x), screenplays:s.screenplays.map(({path:_p,summary:_s,...x})=>x), workflows:HIGGSFIELD_WORKFLOWS}; });
  ipcMain.handle("settings:save", (_e, {apiKey, model, autoUpdate, updateFeedUrl}) => { const s=loadState(); if(apiKey) s.encryptedApiKey=safeStorage.encryptString(apiKey).toString("base64"); if(model) s.model=model; if(typeof autoUpdate==="boolean") s.autoUpdate=autoUpdate; if(typeof updateFeedUrl==="string") s.updateFeedUrl=updateFeedUrl.trim(); saveState(s); return {ok:true, hasApiKey:Boolean(getApiKey(s))}; });
  ipcMain.handle("onboarding:complete", (_e, name) => { const s=loadState(); if(!s.workspaceConfigured) throw new Error("Vælg først dit lokale arbejdsområde."); if(String(name||"").trim()) s.currentUserName=String(name).trim(); if(!s.deviceId) s.deviceId=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`; s.onboardingCompleted=true; saveState(s); return {ok:true}; });
  ipcMain.handle("workspace:get", () => workspaceSnapshot());
  ipcMain.handle("workspace:choose", () => chooseWorkspace());
  ipcMain.handle("screenplay:get", () => screenplaySnapshot());
  ipcMain.handle("screenplay:import", () => importScreenplay());
  ipcMain.handle("screenplay:remove", (_e, id) => removeScreenplay(id));
  ipcMain.handle("screenplay:open-folder", () => { fs.mkdirSync(screenplayDir(), {recursive:true}); return shell.openPath(screenplayDir()); });
  ipcMain.handle("production:get", () => productionSnapshot());
  ipcMain.handle("production:import", () => importProductionPlan());
  ipcMain.handle("production:create", (_e, payload) => createProductionItem(payload));
  ipcMain.handle("production:update", (_e, payload) => updateProductionItem(payload));
  ipcMain.handle("production:remove", (_e, id) => removeProductionItem(id));
  ipcMain.handle("production:open-folder", () => openProductionFolder());
  ipcMain.handle("bible:get", () => bibleSnapshot());
  ipcMain.handle("bible:update", (_e, payload) => updateBible(payload));
  ipcMain.handle("bible:open-folder", () => openProductionBibleFolder());
  ipcMain.handle("shot:create", (_e, payload) => createShot(payload));
  ipcMain.handle("shot:update", (_e, payload) => updateShot(payload));
  ipcMain.handle("shot:remove", (_e, id) => removeShot(id));
  ipcMain.handle("take:rate", (_e, payload) => setTakeRating(payload));
  ipcMain.handle("scene:set-anchor", (_e, payload) => setSceneAnchor(payload));
  ipcMain.handle("engine:open", (_e, id) => openExternalEngine(id));
  ipcMain.handle("assistant:run", (_e, text, engine) => runAssistant(text, engine));
  ipcMain.handle("project:import", () => importFiles());
  ipcMain.handle("project:remove", (_e, id) => { const s=loadState(); const item=s.imports.find(x=>x.id===id); if(item) fs.unlink(item.path,()=>{}); s.imports=s.imports.filter(x=>x.id!==id); saveState(s); return s.imports.map(({path:_p,...x})=>x); });
  ipcMain.handle("voice:transcribe", (_e, data, mime) => transcribeAudio(data, mime));
  ipcMain.handle("image:create", (_e, request) => createReferenceImage(request));
  ipcMain.handle("higgs:open", () => { openHiggsfield(); return true; });
  ipcMain.handle("higgs:navigate", async (_e, url) => { openHiggsfield(); await higgsView.webContents.loadURL(url); return true; });
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
  ipcMain.handle("scene:import-reference-media", (_e, kind) => importSceneReferenceMedia(kind));
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
