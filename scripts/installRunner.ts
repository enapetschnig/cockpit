/**
 * Installiert den BMD-Upload-Runner als macOS-Hintergrunddienst (launchd LaunchAgent).
 * Danach reicht in der App „An BMD senden" – der Dienst prüft alle paar Minuten auf
 * freigegebene Belege (status="queued") und lädt sie ins BMD-Portal. Kein Terminal nötig.
 *
 *   npm run bmd:install      (Intervall via BMD_INTERVAL=Sekunden, Default 180)
 *   npm run bmd:uninstall
 *
 * Idle ist billig: der Runner fragt nur die DB ab und startet den Browser NUR, wenn
 * etwas freigegeben ist.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const LABEL = "at.epower.bmd-runner";
const PROJECT = process.cwd();
const NODE_DIR = path.dirname(process.execPath);
const HOME = os.homedir();
const SUPPORT = path.join(HOME, "Library", "Application Support", "epower-cockpit");
const WRAPPER = path.join(SUPPORT, "bmd-runner.sh");
const PLIST = path.join(HOME, "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG = path.join(HOME, "Library", "Logs", "epower-bmd-runner.log");
const INTERVAL = Math.max(60, Number(process.env.BMD_INTERVAL || 180));

fs.mkdirSync(SUPPORT, { recursive: true });
fs.mkdirSync(path.dirname(PLIST), { recursive: true });
fs.mkdirSync(path.dirname(LOG), { recursive: true });

// Wrapper: PATH unabhängig vom Login-Profil setzen, ins Projekt wechseln, Runner starten.
fs.writeFileSync(
  WRAPPER,
  `#!/bin/bash
export PATH="${PROJECT}/node_modules/.bin:${NODE_DIR}:$PATH"
cd "${PROJECT}" || exit 1
exec tsx scripts/bmdRunner.ts
`,
  { mode: 0o755 }
);

fs.writeFileSync(
  PLIST,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${WRAPPER}</string>
  </array>
  <key>StartInterval</key><integer>${INTERVAL}</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
`
);

try {
  execSync(`launchctl unload "${PLIST}"`, { stdio: "ignore" });
} catch {
  /* war nicht geladen */
}
execSync(`launchctl load -w "${PLIST}"`, { stdio: "inherit" });

console.log("✅ BMD-Runner-Hintergrunddienst installiert.");
console.log(`   Prüft alle ${INTERVAL}s auf freigegebene Belege und lädt sie ins BMD.`);
console.log(`   In der App genügt jetzt „An BMD senden".`);
console.log(`   Log:     ${LOG}`);
console.log(`   Stoppen: npm run bmd:uninstall`);
