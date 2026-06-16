/** Entfernt den BMD-Runner-Hintergrunddienst (launchd LaunchAgent). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const LABEL = "at.epower.bmd-runner";
const PLIST = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

try {
  execSync(`launchctl unload "${PLIST}"`, { stdio: "ignore" });
} catch {
  /* war nicht geladen */
}
try {
  fs.unlinkSync(PLIST);
} catch {
  /* gab es nicht */
}
console.log(`🛑 BMD-Runner-Hintergrunddienst entfernt – „An BMD senden" lädt nicht mehr automatisch hoch.`);
