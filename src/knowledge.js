// Den private projektprofil oprettes af bootstrap-installationen og gemmes i
// brugerens lokale state.json. Den offentliggjorte opdateringskode indeholder
// derfor kun en neutral fallback og overskriver aldrig en eksisterende profil.
const KESSLER_PROFILE = {
  id: "kessler",
  name: "KESSLER",
  subtitle: "Privat lokal projektprofil",
  immutableCore: {
    aspectRatio: "CinemaScope 2.39:1 er låst standardformat. Andre formater bruges kun efter eksplicit ønske.",
    visualWorld: [],
    cameraLanguage: [],
    exclusions: ["Bevar altid den lokalt gemte projekt- og karakterkontinuitet."]
  },
  characters: [],
  promptDoctrine: {
    order: ["fortællingsformål", "karakter og kontinuitet", "handling", "miljø og periode", "kamera og optik", "lys og farve", "bevægelse og timing", "negative begrænsninger"],
    rules: ["Komponér altid projektet i CinemaScope 2.39:1."]
  },
  graphicIdentity: "Indlæses fra den private lokale projektprofil."
};

const HIGGSFIELD_WORKFLOWS = [
  {id:"supercomputer", name:"Supercomputer", route:"https://higgsfield.ai/supercomputer", engine:"Higgsfield Supercomputer", inputs:"Brief + projektviden + ønsket leverance", bestFor:"Flertrins-workflows, shot lists, karakterpakker, scene boards og batchproduktion", advice:"Brug Supercomputer, når én opgave kræver flere sammenhængende trin eller mange assets. Lad Orchestrator vælge delmodel pr. trin, men fasthold Kessler-profilen og 2.39:1 gennem hele kæden."},
  {id:"reference", name:"Billedmager", route:"local-image", engine:"GPT Image 2", inputs:"Idé + Kessler-profil + valgfri reference", bestFor:"Character sheets, location maps, keyframes, props og look development", advice:"Byg rene, kontrollerbare referencepakker før video. Brug samme karakteranker og ændr kun én visuel variabel ad gangen."},
  {id:"image", name:"Higgsfield Image", route:"https://higgsfield.ai/ai/image?model=gpt_image_2", engine:"GPT Image 2 / Nano Banana Pro", inputs:"Prompt + op til 20 referencebilleder + seed", bestFor:"Hero frames, look frames og billedvariationer", advice:"Brug referencebilleder med ét klart ansvar: identitet, kostume, location, lys eller komposition."},
  {id:"seedance25", name:"Video · Seedance 2.5", route:"https://higgsfield.ai/ai/video", engine:"Seedance 2.5", inputs:"Prompt + startframe + valgfrit slutframe", bestFor:"Komplekse handlinger, transformationer, performance og længere sammenhængende filmiske forløb", advice:"Vælg 2.5, når promptforståelse, anatomi og kontinuitet gennem mange beats vejer tungere end native opløsning. Beskriv handling, kamera, timing og fysik kronologisk."},
  {id:"seedance20", name:"Video · Seedance 2.0", route:"https://higgsfield.ai/ai/video", engine:"Seedance 2.0 · 4K", inputs:"Prompt + startframe + valgfrit slutframe", bestFor:"Native 4K, brede billeder, tekstur og enklere kontrollerede shots", advice:"Vælg 2.0, når slutopløsning og detalje i CinemaScope-bredden er vigtigst. Hold shotdesignet mere fokuseret end i 2.5 og test bevægelsen før lange forløb."},
  {id:"cinema", name:"Cinema Studio 4.0", route:"https://higgsfield.ai/generate", engine:"Cinematic v4", inputs:"Single- eller multishot, 4–30 sek., kamera, linse, lys, era, pacing og palette", bestFor:"Filmsekvenser med eksplicit cinematografisk kontrol", advice:"Kessler-default: Drama/Action, 35mm eller DV efter tidslag, Vintage Anamorphic selektivt, Practicals/Overhead fall, Dynamic eller Single shot."},
  {id:"edit", name:"Video Edit", route:"https://higgsfield.ai/ai/video/edit", engine:"Aktuel edit-model", inputs:"Eksisterende video + prompt + op til 20 referencebilleder", bestFor:"Ændre udvalgte elementer uden at genopfinde hele optagelsen", advice:"Skriv både hvad der skal ændres, og hvad der absolut skal bevares: timing, ansigt, blocking, lysretning og kamerabevægelse."},
  {id:"motion", name:"Motion Control", route:"https://higgsfield.ai/ai/video/motion", engine:"Motion transfer", inputs:"Character image + motion reference video + scene prompt", bestFor:"Overføre performance eller bevægelse til en låst karakter", advice:"Character sheet skal matche billedvinkel og kropsudsnit. Vælg motion-reference med tydelig silhuet og uden skjulte led."},
  {id:"reframe", name:"Reframe", route:"https://higgsfield.ai/ai/video/reframe", engine:"Generativ reframing", inputs:"Kildevideo + målformat + valgfri top/bund/venstre/højre-reference", bestFor:"16:9, 9:16, 1:1 og andre leveringsformater", advice:"Lav side-referencer fra samme location og lys, så udvidelsen føles som original optagelse frem for generisk outpaint."},
  {id:"genjutsu", name:"Genjutsu", route:"https://higgsfield.ai/ai/video?model=genjutsu", engine:"Genjutsu", inputs:"Én video på 4–30 sek. + op til 30 referencer + preset/kort beskrivelse", bestFor:"Motion Transfer eller Object Swap med bevaret timing, framing og kamerabevægelse", advice:"Brug Genjutsu, når den eksisterende bevægelse allerede fungerer, og kun karakter, location, kostume, prop eller stil skal skiftes. Output er op til 1080p."}
];

function buildSystemPrompt(project, librarySummary = "") {
  return `Du er Brightside Film Remote, Nicolas Tobias Følsgaards senior film-, continuity- og promptassistent.
Du tænker som instruktør, DOP, VFX-supervisor og prompt specialist på samme tid. Du taler kort og klart på dansk, men skriver selve Higgsfield-prompts på præcist filmisk engelsk, medmindre Nicolas beder om andet.

AKTIV PROJEKTPROFIL:\n${JSON.stringify(project, null, 2)}

TILFØJET PROJEKTMATERIALE:\n${librarySummary || "Intet yderligere materiale endnu."}

HIGGSFIELD WORKFLOW-KORT:\n${JSON.stringify(HIGGSFIELD_WORKFLOWS, null, 2)}

ARBEJDSREGLER:
1. Beskyt karakterkontinuitet, geografi, periode, kostume, skader, lysretning og linse-/kameralogik.
2. Skeln mellem et idéforslag, en færdig prompt og en handling i Higgsfield.
3. Før en Higgsfield-handling: inspicér den aktuelle skærm. Brug kun de tilgængelige værktøjer.
4. Alle klik eller tastetryk skal have et kort formål. Markér credit_spend ved Generate/Render/Extend/Retry eller anden handling, der kan bruge credits. Markér external_effect ved download, sletning eller publicering. Alt andet er safe.
5. Stop og forklar, hvis UI'et er uklart. Gæt aldrig på knapper, der kan bruge credits.
6. Når Nicolas beder om variationer, behold alle ikke-nævnte parametre låst.
7. Anbefal altid den konkrete workflow/engine, nødvendige input-assets og en kort begrundelse før du bygger prompten.
8. Hvis et workflow mangler referencegrundlag, hjælp først med character sheet, location map, keyframe, prop sheet eller continuity pack.
9. Hvis engine står på AUTO, vælg mellem Supercomputer, Seedance 2.5, Seedance 2.0, Genjutsu og de øvrige workflows ud fra opgaven og forklar valget kort. Seedance 2.5 prioriteres til komplekse fler-beat shots og performance; Seedance 2.0 til native 4K og detalje; Genjutsu til målrettede ændringer i eksisterende video; Supercomputer til flertrins- og batchworkflows.
10. Afslut med en kort status: hvad blev ændret, og hvad er næste sikre valg.`;
}

module.exports = { KESSLER_PROFILE, HIGGSFIELD_WORKFLOWS, buildSystemPrompt };
