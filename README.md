# Brightside Film Remote — version 0.8.2

Version 0.8.2 gendanner det lokale Claude + OpenAI-parløb og bevarer projektarkivet fra 0.8.1. Under Indstillinger kan Claude tilsluttes med egen Anthropic-nøgle, modelnavn og valgfrit workspace-id. Begge assistenter vurderer opgaven, og den valgte OpenAI-model samler forslagene. Claude modtager tekstkontekst, ikke selve referencefilmene. API-adgang afhænger af brugerens konto og modelvalg.

Udgaven indeholder også samlet manusanalyse, karakterregister og scenesøgning. Tidligere lokalt gemte manusfiler bevares ved arkivflytning; et aktivt uploadet manus kan bruges som kilde, når der ikke er gemt et manus i teksteditoren.

En lokal Apple Silicon Mac-app med synlig Higgsfield-browser, dansk chat og stemmestyring, filmspecialiseret promptarbejde, Kessler-projektprofil og godkendelse før credit-forbrug.

Version 0.7.2 er den personlige Nicolas/Admin-udgave. Flerbruger, fælles login og Supabase er bevidst taget ud af brugerfladen, så den lokale filmproduktion er enkel og robust først.

Referencefilm og referencebilleder kan uploades fra store, tydelige knapper i Assistent og Scener. De gemmes automatisk i den aktive scenes separate `Referencer/Billeder`- og `Referencer/Film`-mapper og registreres i Production Bible.

Den manuelle opdateringsknap virker også, når automatisk opdatering er slået fra, og viser nu søgning, download, fejl og afslutningsstatus direkte i den orange knap.

## Production Bible

- Én lokal KESSLER Production Bible i både JSON og læsbar Markdown.
- Låst visuel stil, kamera/linse, karakterkontinuitet, location/lys og negative regler.
- Scene → shot-struktur med engine, prompt og status.
- Readiness-kontrol før en scene sendes i produktion.
- Character sheets og location maps bindes som låste elementer til den aktive scene.
- Separat baggrundslag til kontrolleret udskiftning af miljø uden at ændre forgrund, performance, timing eller kamera.
- Anchor frame og rød/gul/grøn vurdering af Work- og Final-takes.

Appen indeholder et Engine Center til Higgsfield Image, Seedance 2.5/2.0, Supercomputer, Cinema Studio, Video Edit, Motion Control, Reframe, Genjutsu samt promptkontrakter og officielle links til Veo, Kling og Runway. Den integrerede Billedmager bruger GPT Image 2 til keyframes, character sheets, location maps, continuity sheets, props og lys-/linse-referencer.

Kessler arbejder som standard udelukkende i CinemaScope 2.39:1. Workflowvælgeren kan stå på Auto eller låses til Supercomputer, Seedance 2.5, Seedance 2.0, Genjutsu eller Cinema Studio. Auto vælger model efter opgaven: 2.5 til komplekse fler-beat shots og performance, 2.0 til native 4K og detalje, Genjutsu til Motion Transfer/Object Swap og Supercomputer til flertrins- og batchproduktion.

## Start på en Mac

1. Installer Node.js 22 eller nyere fra nodejs.org.
2. Åbn Terminal i denne mappe.
3. Kør `npm install`.
4. Kør `npm start`.
5. Åbn Indstillinger i appen, indsæt din OpenAI API-nøgle, og log ind på Higgsfield i højre side.

## Lav en lokal Mac-app

Kør `npm run dist:mac`. Den usignerede Apple Silicon `.zip` lægges i `dist`. Pak den ud og højreklik på appen → Åbn første gang.

## Sikkerhed

- API-nøglen krypteres med macOS' lokale kryptering.
- Higgsfield-login gemmes i en separat lokal browserprofil.
- Appen beder om godkendelse før Generate/Render/Extend/Retry og andre handlinger, der kan bruge credits.
- Du kan godkende én generering eller de næste 10 faktiske genereringer. Prompts, navigation og indstillinger tæller ikke. Tælleren nulstilles, når appen lukkes.
- Appen søger automatisk efter nye versioner ved start og derefter hver sjette time.
- Opdateringer hentes kun fra Brightsides faste GitHub-kanal og kontrolleres med SHA-256 før installation.
- Login, API-nøgle, projektmateriale og referencer ligger uden for app-pakken og bevares ved opdatering.
- Første gang vælger Nicolas selv det lokale arbejdsområde. Appen opretter et nummereret `KESSLER`-arkiv med særskilte mapper til projekt/manus, referencer, elementer, scener, renderinger, leveringer og produktion.
- Manus kan uploades som PDF, DOCX, FDX, TXT eller Markdown i Project Bible. Den nyeste version gemmes lokalt som aktivt manus og indgår automatisk i assistentens forståelse af historie, scener, karakterer og locations.
- State gemmes atomisk med en lokal backup, så et afbrudt save ikke så let kan ødelægge projektet.
- “Kopiér til Final” bevarer Work-originalen. Allan-mastere versionsnummereres også mod filer, der allerede ligger i leveringsmappen.
- Betaling og køb er ikke en del af denne testversion.

## Kessler-profil

Den indbyggede kerne indeholder filmens etablerede visuelle verden, kameraregler, karakterkontinuitet og fravalg. Under **Visuel identitet** kan du tilføje PDF, manus, lookbook, tekst og referencebilleder. Tilføjelser udvider profilen; de overskriver ikke den låste kerne.
