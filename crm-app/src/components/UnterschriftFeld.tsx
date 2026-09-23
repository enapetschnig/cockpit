/**
 * Unterschriftsfeld, das am Handy ins Vollbild geht: ein Tipp öffnet eine
 * Fläche über den ganzen Bildschirm – quer gehalten so breit wie das Handy.
 * Android dreht dabei von selbst ins Querformat; das iPhone kann das nicht
 * erzwingen, dort steht ein Hinweis. Am PC bleibt es das normale Feld.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SignaturePad } from '@/components/SignaturePad';
import { Check, PenLine, RotateCw, X } from 'lucide-react';

const istTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

interface Props {
  /** PNG (Data-URL) der Unterschrift; null = leer. */
  onChange: (png: string | null) => void;
  height?: number;
  titel?: string;
}

export function UnterschriftFeld({ onChange, height = 170, titel = 'Hier unterschreiben' }: Props) {
  const [touch] = useState(istTouch);
  const [offen, setOffen] = useState(false);
  const [png, setPng] = useState<string | null>(null);

  if (!touch) return <SignaturePad onChange={onChange} height={height} />;

  return (
    <div>
      <button type="button" onClick={() => setOffen(true)} style={{ height }}
        className="w-full rounded-lg border-2 border-dashed border-muted-foreground/40 bg-white flex flex-col items-center justify-center gap-1 text-muted-foreground">
        {png ? (
          <img src={png} alt="Ihre Unterschrift" className="max-h-[75%] max-w-[90%] object-contain" />
        ) : (
          <>
            <PenLine className="w-6 h-6" />
            <span className="text-sm font-medium text-foreground">Tippen zum Unterschreiben</span>
            <span className="text-xs">öffnet ein großes Feld – am besten quer halten</span>
          </>
        )}
      </button>
      {png && (
        <div className="flex justify-end mt-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOffen(true)}>Neu unterschreiben</Button>
        </div>
      )}
      <Vollbild offen={offen} titel={titel} onAbbrechen={() => setOffen(false)}
        onFertig={(p) => { setPng(p); onChange(p); setOffen(false); }} />
    </div>
  );
}

function Vollbild({ offen, titel, onAbbrechen, onFertig }: {
  offen: boolean; titel: string; onAbbrechen: () => void; onFertig: (png: string) => void;
}) {
  const [png, setPng] = useState<string | null>(null);
  const [flaeche, setFlaeche] = useState<HTMLDivElement | null>(null);
  const [h, setH] = useState(200);
  const [hoch, setHoch] = useState(false);

  useEffect(() => { if (offen) setPng(null); }, [offen]);

  // Feldhöhe an den freien Platz anpassen – auch nach dem Drehen.
  useEffect(() => {
    if (!flaeche) return;
    const messen = () => {
      setH(Math.max(120, flaeche.clientHeight - 36)); // 36 = Zeile mit „Neu"
      setHoch(window.innerHeight > window.innerWidth);
    };
    messen();
    const ro = new ResizeObserver(messen); ro.observe(flaeche);
    window.addEventListener('orientationchange', messen);
    return () => { ro.disconnect(); window.removeEventListener('orientationchange', messen); };
  }, [flaeche]);

  // Android: Vollbild und quer sperren. Geht es nicht (iPhone, PC), bleibt es beim Hinweis.
  useEffect(() => {
    if (!offen) return;
    const o = screen.orientation as ScreenOrientation & { lock?: (x: string) => Promise<void>; unlock?: () => void };
    (async () => {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
        await o?.lock?.('landscape');
      } catch { /* nicht unterstützt */ }
    })();
    return () => {
      try { o?.unlock?.(); } catch { /* egal */ }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* egal */ });
    };
  }, [offen]);

  return (
    <Dialog open={offen} onOpenChange={(o) => { if (!o) onAbbrechen(); }}>
      <DialogContent aria-describedby={undefined}
        className="left-0 top-0 translate-x-0 translate-y-0 max-w-none w-screen h-[100dvh] rounded-none sm:rounded-none border-0 p-3 gap-2 flex flex-col [&>button]:hidden data-[state=open]:animate-none data-[state=closed]:animate-none">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={onAbbrechen}><X className="w-4 h-4" /> Abbrechen</Button>
          <DialogTitle className="flex-1 text-center text-base truncate">{titel}</DialogTitle>
          <Button type="button" size="sm" className="gap-1" disabled={!png} onClick={() => png && onFertig(png)}><Check className="w-4 h-4" /> Übernehmen</Button>
        </div>
        {hoch && (
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
            <RotateCw className="w-3.5 h-3.5" /> Tipp: Handy quer halten – dann ist das Feld viel breiter.
          </p>
        )}
        <div ref={setFlaeche} className="flex-1 min-h-0 overflow-hidden">
          <SignaturePad onChange={setPng} height={h} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
