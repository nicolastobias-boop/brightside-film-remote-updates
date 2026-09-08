# Brightside Film Remote — version 0.3.0

En lokal Apple Silicon Mac-app med synlig Higgsfield-browser, dansk chat og stemmestyring, filmspecialiseret promptarbejde, Kessler-projektprofil og godkendelse før credit-forbrug.

Appen indeholder et workflow-kort til Higgsfield Image, Seedance 2.5, Cinema Studio 4.0, Video Edit, Motion Control, Reframe og Genjutsu. Den integrerede Billedmager bruger GPT Image 2 til keyframes, character sheets, location maps, continuity sheets, props og lys-/linse-referencer. Projektbilleder kan bruges som high-fidelity input, og nye billeder lægges automatisk i projektets visuelle hukommelse.

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
- Alt projektmateriale gemmes synligt i `Film/Brightside Film Remote/KESSLER` på Mac'en. Her oprettes mapper til prompts, character sheets, location maps, genererede billeder og importerede referencer.
- Betaling og køb er ikke en del af denne testversion.

## Kessler-profil

Den indbyggede kerne indeholder filmens etablerede visuelle verden, kameraregler, karakterkontinuitet og fravalg. Under **Visuel identitet** kan du tilføje PDF, manus, lookbook, tekst og referencebilleder. Tilføjelser udvider profilen; de overskriver ikke den låste kerne.
