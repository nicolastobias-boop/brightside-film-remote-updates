const ENGINE_CATALOG = [
  {id:"auto",name:"Brightside Auto",provider:"Brightside",status:"ready",bestFor:"Vælger workflow ud fra shot, referencer og kontinuitetskrav.",inputs:"Brief + scene + låste elementer",promptOrder:["formål","kontinuitet","handling","kamera","lys","timing","begrænsninger"]},
  {id:"seedance25",name:"Seedance 2.5",provider:"Higgsfield",status:"ready",bestFor:"Komplekse handlinger, performance og flere beats.",inputs:"Startframe, evt. slutframe og kronologisk prompt",promptOrder:["karakter","handling beat for beat","kamera","fysik","25 fps"]},
  {id:"seedance20",name:"Seedance 2.0",provider:"Higgsfield",status:"ready",bestFor:"Detalje, brede billeder og kontrollerede 4K-shots.",inputs:"Stærkt startframe og fokuseret bevægelse",promptOrder:["motiv","én bevægelse","kamera","tekstur","25 fps"]},
  {id:"supercomputer",name:"Supercomputer",provider:"Higgsfield",status:"ready",bestFor:"Flertrinsforløb, batch og sammenhængende asset-pakker.",inputs:"Leverancebrief + Project Bible",promptOrder:["leverance","deltrin","låse","kontrolpunkter"]},
  {id:"cinema",name:"Cinema Studio",provider:"Higgsfield",status:"ready",bestFor:"Linse, kamera, lys og filmisk shotkontrol.",inputs:"Keyframe + kamera/linse/lys",promptOrder:["scene","kamera","linse","lys","pacing"]},
  {id:"genjutsu",name:"Genjutsu",provider:"Higgsfield",status:"ready",bestFor:"Object swap og motion transfer med bevaret timing.",inputs:"Kildevideo + målrettede referencer",promptOrder:["ændring","bevar timing","bevar framing","bevar bevægelse"]},
  {id:"background-swap",name:"Baggrundslag",provider:"Higgsfield",status:"ready",bestFor:"Udskift location- eller baggrundselementer uden at ændre forgrund og performance.",inputs:"Kildevideo + ren background plate + låste karakterreferencer",promptOrder:["lås forgrund","udskift kun baggrund","match perspektiv","match lys","bevar timing og kamera"]},
  {id:"veo31",name:"Veo 3.1",provider:"Google",status:"external",url:"https://aistudio.google.com/",bestFor:"Dialog, lyd og længere naturalistiske videobeats.",inputs:"Konkret scene, præcis dialog og lydretning",promptOrder:["stil","location","karakter","handling","dialog","lyd"]},
  {id:"kling",name:"Kling",provider:"Kuaishou",status:"external",url:"https://klingai.com/",bestFor:"Kontrolleret image-to-video og fysisk bevægelse.",inputs:"Keyframe + tydelige @Element-referencer",promptOrder:["masterstil","elementer","handling","kamera","negative låse"]},
  {id:"runway",name:"Runway",provider:"Runway",status:"external",url:"https://app.runwayml.com/",bestFor:"Videoarbejde, retakes, compositing og upscale-workflows.",inputs:"Kildeasset + afgrænset ændring",promptOrder:["bevar","ændr","kamera","finish"]},
  {id:"openai-image",name:"OpenAI Billedmager",provider:"OpenAI",status:"ready",bestFor:"Anchor frames, character sheets, locations og continuity boards.",inputs:"Brief + identitetsreferencer",promptOrder:["identitet","design","kamera","lys","2.39:1"]}
];

function normalizeBible(state) {
  state.projectMeta = state.projectMeta && typeof state.projectMeta === "object" ? state.projectMeta : {};
  state.styleLocks = state.styleLocks && typeof state.styleLocks === "object" ? state.styleLocks : {};
  state.shots = Array.isArray(state.shots) ? state.shots : [];
  state.takeRatings = state.takeRatings && typeof state.takeRatings === "object" ? state.takeRatings : {};
  state.sceneBindings = Array.isArray(state.sceneBindings) ? state.sceneBindings : [];
  return state;
}

function readiness(state) {
  normalizeBible(state);
  const active = state.scenes.find(scene => scene.id === state.activeSceneId);
  const sceneShots = active ? state.shots.filter(shot => shot.sceneId === active.id) : [];
  const checks = [
    {id:"scene",label:"Aktiv scene",ready:Boolean(active)},
    {id:"style",label:"Visuel stil låst",ready:Boolean(state.styleLocks.visualStyle)},
    {id:"lens",label:"Kamera og linse låst",ready:Boolean(state.styleLocks.cameraLens)},
    {id:"characters",label:"Karakterkontinuitet",ready:Boolean(state.styleLocks.characterContinuity)},
    {id:"location",label:"Location og lys",ready:Boolean(state.styleLocks.locationLighting)},
    {id:"shots",label:"Mindst ét planlagt shot",ready:sceneShots.length > 0}
  ];
  return {checks,ready:checks.filter(item => item.ready).length,total:checks.length};
}

function buildBibleText(state) {
  normalizeBible(state);
  const active = state.scenes.find(scene => scene.id === state.activeSceneId);
  const sceneShots = active ? state.shots.filter(shot => shot.sceneId === active.id) : [];
  const status = readiness(state);
  return [
    "# KESSLER · BRIGHTSIDE PRODUCTION BIBLE",
    "",
    `Opdateret: ${new Date().toISOString()}`,
    "Fast format: CinemaScope 2.39:1",
    "Fast timebase: 25 fps",
    "",
    "## Projekt",
    `Logline: ${state.projectMeta.logline || "Ikke udfyldt"}`,
    `Tone: ${state.projectMeta.tone || "Ikke udfyldt"}`,
    "",
    "## Låst kontinuitet",
    `Visuel stil: ${state.styleLocks.visualStyle || "Ikke låst"}`,
    `Kamera og linse: ${state.styleLocks.cameraLens || "Ikke låst"}`,
    `Karakterer: ${state.styleLocks.characterContinuity || "Ikke låst"}`,
    `Location og lys: ${state.styleLocks.locationLighting || "Ikke låst"}`,
    `Negative regler: ${state.styleLocks.exclusions || "Ikke låst"}`,
    "",
    `## Aktiv scene · ${active ? active.title : "Ingen"}`,
    ...sceneShots.flatMap(shot => [
      `### ${shot.code || "SHOT"} · ${shot.title}`,
      `Engine: ${shot.engine || "auto"}`,
      `Status: ${shot.status || "planlagt"}`,
      `Prompt: ${shot.prompt || "Ikke skrevet"}`,
      ""
    ]),
    "## Klarhed",
    `${status.ready}/${status.total} kontrolpunkter er klar.`,
    ...status.checks.map(item => `- [${item.ready ? "x" : " "}] ${item.label}`),
    ""
  ].join("\n");
}

module.exports = { ENGINE_CATALOG, normalizeBible, readiness, buildBibleText };
