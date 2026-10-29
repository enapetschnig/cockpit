/**
 * Spielt eine „Zeigen & erklären"-Aufnahme aus einer Handwerker-App ab (29.10.2026).
 *
 * Die App zeichnet kein Video auf, sondern die Seite selbst (rrweb, gzip-JSON)
 * plus Ton. Hier wird beides zusammengeführt: Der Ton ist die Uhr — Abspielen,
 * Anhalten und Springen im Ton bewegen die Bildschirmaufnahme mit.
 * Ohne Ton läuft die Aufnahme mit eigenen Knöpfen.
 */
import { useEffect, useRef, useState } from 'react';
import { gunzipSync, strFromU8 } from 'fflate';
import { Loader2, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import 'rrweb/dist/style.css';

interface Props {
  /** URL der Aufnahme (Proxy /api/wuensche-datei?art=aufnahme) */
  aufnahmeUrl: string;
  /** URL des Tons, falls vorhanden */
  tonUrl: string | null;
}

type Replayer = import('rrweb').Replayer;

export function AufnahmeAbspielen({ aufnahmeUrl, tonUrl }: Props) {
  const rahmen = useRef<HTMLDivElement>(null);
  const buehne = useRef<HTMLDivElement>(null);
  const ton = useRef<HTMLAudioElement>(null);
  const player = useRef<Replayer | null>(null);
  /** Bildschirmgröße beim Aufnehmen (Meta-Ereignis bzw. „resize" des Abspielers). */
  const masse = useRef({ breite: 1280, hoehe: 800 });
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [spielt, setSpielt] = useState(false);

  useEffect(() => {
    let weg = false;
    (async () => {
      try {
        const res = await fetch(aufnahmeUrl);
        if (!res.ok) throw new Error(`Aufnahme nicht ladbar (${res.status})`);
        const roh = new Uint8Array(await res.arrayBuffer());
        // gzip erkennen (1f 8b) – sonst ist es schon JSON.
        const json = roh[0] === 0x1f && roh[1] === 0x8b ? strFromU8(gunzipSync(roh)) : strFromU8(roh);
        const daten = JSON.parse(json) as { ereignisse: unknown[] };
        if (!Array.isArray(daten.ereignisse) || daten.ereignisse.length < 2) throw new Error('Die Aufnahme ist leer.');
        const meta = (daten.ereignisse as { type?: number; data?: { width?: number; height?: number } }[]).find((e) => e.type === 4);
        if (meta?.data?.width && meta.data.height) masse.current = { breite: meta.data.width, hoehe: meta.data.height };
        const { Replayer } = await import('rrweb');
        if (weg || !buehne.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = new Replayer(daten.ereignisse as any, {
          root: buehne.current,
          mouseTail: false,
          skipInactive: false,
          // Die Seite läuft in einem iframe ohne allow-scripts: aus der Aufnahme wird nichts ausgeführt.
        });
        player.current = r;
        r.on('resize', (d) => {
          const { width, height } = d as { width?: number; height?: number };
          if (width && height) { masse.current = { breite: width, hoehe: height }; einpassen(); }
        });
        r.pause(0);
        einpassen();
        setLaedt(false);
      } catch (e) {
        if (!weg) { setFehler(e instanceof Error ? e.message : 'Aufnahme nicht ladbar'); setLaedt(false); }
      }
    })();
    const beiGroesse = () => einpassen();
    window.addEventListener('resize', beiGroesse);
    return () => {
      weg = true;
      window.removeEventListener('resize', beiGroesse);
      player.current?.destroy();
      player.current = null;
    };
  }, [aufnahmeUrl]);

  /** Die aufgenommene Seite (z. B. Handy-Breite) in den verfügbaren Platz skalieren. */
  function einpassen() {
    const wrapper = buehne.current?.querySelector('.replayer-wrapper') as HTMLElement | null;
    if (!wrapper || !rahmen.current) return;
    const { breite, hoehe } = masse.current;
    // Platz = Breite der Spalte (der Rahmen selbst wird gleich auf die Inhaltsbreite gesetzt).
    const platz = rahmen.current.parentElement?.clientWidth || rahmen.current.clientWidth;
    const faktor = Math.min(1, platz / breite, 560 / hoehe);
    wrapper.style.transform = `scale(${faktor})`;
    wrapper.style.transformOrigin = 'top left';
    rahmen.current.style.height = `${Math.ceil(hoehe * faktor)}px`;
    rahmen.current.style.width = `${Math.ceil(breite * faktor)}px`;
  }

  // Ton ist die Uhr.
  const zeitMs = () => (ton.current?.currentTime ?? 0) * 1000;
  const tonEvents = {
    onPlay: () => { player.current?.play(zeitMs()); setSpielt(true); },
    onPause: () => { player.current?.pause(zeitMs()); setSpielt(false); },
    onSeeked: () => {
      if (ton.current?.paused) player.current?.pause(zeitMs());
      else player.current?.play(zeitMs());
    },
    onEnded: () => setSpielt(false),
  };

  const ohneTonUmschalten = () => {
    const r = player.current;
    if (!r) return;
    if (spielt) { r.pause(); setSpielt(false); } else { r.play(r.getCurrentTime()); setSpielt(true); }
  };

  return (
    <div className="mt-3 space-y-2">
      <div ref={rahmen} className="relative max-w-full overflow-hidden rounded-md border bg-muted/30" style={{ height: 240 }}>
        <div ref={buehne} />
        {laedt && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Aufnahme wird geladen …
          </div>
        )}
        {fehler && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-sm text-muted-foreground">{fehler}</div>
        )}
      </div>
      {tonUrl ? (
        <audio ref={ton} controls preload="metadata" src={tonUrl} className="w-full max-w-md" {...tonEvents} />
      ) : (
        !laedt && !fehler && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={ohneTonUmschalten}>
            {spielt ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {spielt ? 'Anhalten' : 'Abspielen'}
          </Button>
        )
      )}
    </div>
  );
}
