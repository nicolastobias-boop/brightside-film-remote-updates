const { app, dialog } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { execFileSync, spawn } = require("child_process");

const REPOSITORY = "nicolastobias-boop/brightside-film-remote-updates";
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASE_PREFIX = `https://github.com/${REPOSITORY}/releases/download/`;
let interval;
let checking = false;

function versionParts(value) {
  return String(value).replace(/^v/i, "").split(".").map(part => Number.parseInt(part, 10) || 0);
}

function isNewer(candidate, current) {
  const next = versionParts(candidate);
  const now = versionParts(current);
  for (let i = 0; i < Math.max(next.length, now.length); i += 1) {
    if ((next[i] || 0) > (now[i] || 0)) return true;
    if ((next[i] || 0) < (now[i] || 0)) return false;
  }
  return false;
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Brightside-Film-Remote-Updater" }
  });
  if (!response.ok) throw new Error(`GitHub svarede ${response.status}`);
  return response.json();
}

async function download(url, destination) {
  if (!url.startsWith(RELEASE_PREFIX)) throw new Error("Opdateringsadressen er ikke godkendt");
  const response = await fetch(url, { headers: { "User-Agent": "Brightside-Film-Remote-Updater" } });
  if (!response.ok || !response.body) throw new Error(`Download fejlede (${response.status})`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function findApp(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name === "Brightside Film Remote.app") return fullPath;
    if (entry.isDirectory()) {
      const nested = findApp(fullPath);
      if (nested) return nested;
    }
  }
  return null;
}

function installAfterQuit(stagedApp) {
  const currentApp = path.resolve(path.dirname(process.execPath), "..", "..");
  if (!currentApp.endsWith(".app")) throw new Error("Appen skal startes fra den installerede Mac-app");
  const helper = path.join(os.tmpdir(), `brightside-update-${Date.now()}.command`);
  const backup = `${currentApp}.previous`;
  const script = `#!/bin/bash
set -e
PID="$1"
CURRENT="$2"
STAGED="$3"
BACKUP="$4"
while kill -0 "$PID" 2>/dev/null; do sleep 1; done
rm -rf "$BACKUP"
mv "$CURRENT" "$BACKUP"
if /usr/bin/ditto "$STAGED" "$CURRENT"; then
  rm -rf "$BACKUP"
  /usr/bin/open "$CURRENT"
else
  rm -rf "$CURRENT"
  mv "$BACKUP" "$CURRENT"
  /usr/bin/open "$CURRENT"
fi
rm -rf "$(dirname "$STAGED")"
rm -f "$0"
`;
  fs.writeFileSync(helper, script, { mode: 0o700 });
  const child = spawn("/bin/bash", [helper, String(process.pid), currentApp, stagedApp, backup], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  app.quit();
}

async function prepareUpdate(release, notify) {
  const zipAsset = release.assets.find(asset => /arm64-mac\.zip$/.test(asset.name));
  const checksumAsset = release.assets.find(asset => asset.name === `${zipAsset?.name}.sha256`);
  if (!zipAsset || !checksumAsset) throw new Error("Udgivelsen mangler Mac-pakke eller kontrolsum");

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "brightside-update-"));
  const zipPath = path.join(workspace, zipAsset.name);
  notify(`Henter version ${release.tag_name.replace(/^v/, "")}…`);
  await download(zipAsset.browser_download_url, zipPath);

  const checksumResponse = await fetch(checksumAsset.browser_download_url, {
    headers: { "User-Agent": "Brightside-Film-Remote-Updater" }
  });
  if (!checksumResponse.ok) throw new Error("Kontrolsummen kunne ikke hentes");
  const expected = (await checksumResponse.text()).trim().split(/\s+/)[0].toLowerCase();
  const actual = await sha256(zipPath);
  if (!/^[a-f0-9]{64}$/.test(expected) || actual !== expected) {
    throw new Error("Sikkerhedskontrollen af opdateringen mislykkedes");
  }

  const extractDirectory = path.join(workspace, "unpacked");
  fs.mkdirSync(extractDirectory);
  execFileSync("/usr/bin/ditto", ["-x", "-k", zipPath, extractDirectory]);
  const stagedApp = findApp(extractDirectory);
  if (!stagedApp) throw new Error("Den downloadede Mac-app kunne ikke findes");
  return stagedApp;
}

function setupUpdater({ getSettings, notify }) {
  const check = async (manual = false) => {
    const settings = getSettings();
    if (!app.isPackaged) return notify("Auto-update testes først i den pakkede app");
    if (!settings.autoUpdate) return notify("Automatiske opdateringer er slået fra");
    if (checking) return notify("Der søges allerede efter en opdatering");

    checking = true;
    if (manual) notify("Søger efter ny version…");
    try {
      const release = await githubJson(RELEASE_API);
      const nextVersion = release.tag_name.replace(/^v/, "");
      if (!isNewer(nextVersion, app.getVersion())) {
        if (manual) notify("Appen er opdateret");
        return;
      }

      const choice = await dialog.showMessageBox({
        type: "info",
        title: "Ny Brightside Film Remote",
        message: `Version ${nextVersion} er klar.`,
        detail: "Opdateringen erstatter kun selve appen. Login, API-nøgle, projekter og referencer bevares.",
        buttons: ["Hent og installer", "Senere"],
        defaultId: 0,
        cancelId: 1
      });
      if (choice.response !== 0) return;

      const stagedApp = await prepareUpdate(release, notify);
      const installChoice = await dialog.showMessageBox({
        type: "info",
        title: "Opdateringen er klar",
        message: `Version ${nextVersion} er hentet og sikkerhedskontrolleret.`,
        detail: "Appen genstarter nu og installerer opdateringen. Dine lokale data bliver liggende.",
        buttons: ["Genstart og installer", "Senere"],
        defaultId: 0,
        cancelId: 1
      });
      if (installChoice.response === 0) installAfterQuit(stagedApp);
    } catch (error) {
      notify(`Opdatering kunne ikke gennemføres: ${error.message}`);
    } finally {
      checking = false;
    }
  };

  setTimeout(() => check(false), 15000);
  interval = setInterval(() => check(false), 6 * 60 * 60 * 1000);
  return () => check(true);
}

function stopUpdater() {
  if (interval) clearInterval(interval);
}

module.exports = { setupUpdater, stopUpdater, isNewer };
