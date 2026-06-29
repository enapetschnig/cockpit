"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "a2hs_dismissed_v1";

type Mode = "ios" | "ios-other" | "android";

// Zeigt beim ersten mobilen Login eine Anleitung, wie man das Cockpit
// als App auf den Start-/Home-Bildschirm legt (iPhone: Safari-Teilen-Menü).
export default function AddToHomeScreen() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [show, setShow] = useState(false);
  // Android: das verzögerte Installations-Event von Chrome
  const [deferred, setDeferred] = useState<{ prompt: () => void; userChoice: Promise<unknown> } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // schon installiert? (im Standalone-Modus geöffnet)
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    // schon weggetippt?
    try { if (localStorage.getItem(DISMISS_KEY)) return; } catch { /* ignore */ }
    // nicht auf der Login-Seite
    if (window.location.pathname.startsWith("/login")) return;

    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);

    let m: Mode | null = null;
    if (isIOS) m = isSafari ? "ios" : "ios-other";
    else if (isAndroid) m = "android";
    if (!m) return; // Desktop: keine Anleitung

    setMode(m);
    const t = setTimeout(() => setShow(true), 700);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as unknown as { prompt: () => void; userChoice: Promise<unknown> });
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => { clearTimeout(t); window.removeEventListener("beforeinstallprompt", onPrompt); };
  }, []);

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  }
  async function androidInstall() {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* ignore */ }
    dismiss();
  }

  if (!show || !mode) return null;

  return (
    <div className="a2hs" role="dialog" aria-label="App installieren">
      <div className="a2hs-card">
        <button className="a2hs-x" onClick={dismiss} aria-label="Schließen">✕</button>
        <div className="a2hs-head">
          <span className="a2hs-icon">
            <svg width="26" height="26" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#2f6df0" /><path d="M286 72 L150 296 H236 L210 440 L372 204 H276 Z" fill="#fff" /></svg>
          </span>
          <div>
            <div className="a2hs-title">App auf den Startbildschirm</div>
            <div className="a2hs-sub">So hast du das Cockpit wie eine echte App immer griffbereit.</div>
          </div>
        </div>

        {mode === "ios" && (
          <ol className="a2hs-steps">
            <li>Tippe unten in Safari auf das <b>Teilen-Symbol</b> <ShareGlyph />.</li>
            <li>Etwas nach unten wischen und auf <b>„Zum Home-Bildschirm"</b> tippen.</li>
            <li>Oben rechts auf <b>„Hinzufügen"</b> tippen – fertig! 🎉</li>
          </ol>
        )}

        {mode === "ios-other" && (
          <div className="a2hs-note">
            Öffne diese Seite einmal in <b>Safari</b>, um die App auf den Home-Bildschirm zu legen
            (in Chrome/anderen Browsern bietet das iPhone diese Funktion leider nicht an).
          </div>
        )}

        {mode === "android" && (
          deferred ? (
            <button className="a2hs-install" onClick={androidInstall}>📲 Jetzt installieren</button>
          ) : (
            <ol className="a2hs-steps">
              <li>Tippe oben rechts im Browser auf das <b>Menü ⋮</b>.</li>
              <li>Wähle <b>„App installieren"</b> bzw. <b>„Zum Startbildschirm hinzufügen"</b>.</li>
            </ol>
          )
        )}

        <button className="a2hs-ok" onClick={dismiss}>{mode === "ios-other" ? "Verstanden" : "Alles klar"}</button>
      </div>
    </div>
  );
}

// iOS-Teilen-Symbol (Quadrat mit Pfeil nach oben)
function ShareGlyph() {
  return (
    <svg className="a2hs-share" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#2f6df0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4" /><path d="M8 8l4-4 4 4" /><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}
