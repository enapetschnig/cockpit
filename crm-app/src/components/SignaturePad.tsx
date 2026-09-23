/**
 * Unterschrift mit Finger oder Maus. Kein Fremdpaket – ein Canvas, das
 * Pointer-Ereignisse mitschreibt und am Ende ein PNG liefert.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Eraser } from 'lucide-react';

interface Props {
  /** Wird bei jedem Strich mit dem aktuellen PNG (Data-URL) gerufen; null = leer. */
  onChange: (png: string | null) => void;
  height?: number;
  className?: string;
}

/**
 * Nur die Striche plus etwas Rand – sonst wird die Unterschrift im PDF-Kasten
 * verzerrt, je nachdem wie breit das Feld am jeweiligen Gerät war.
 */
function zugeschnitten(c: HTMLCanvasElement): string {
  const { width: w, height: h } = c;
  const d = c.getContext('2d')!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return c.toDataURL('image/png');
  const rand = Math.round(6 * (window.devicePixelRatio || 1));
  x0 = Math.max(0, x0 - rand); y0 = Math.max(0, y0 - rand);
  x1 = Math.min(w - 1, x1 + rand); y1 = Math.min(h - 1, y1 + rand);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // Vollbild am Handy ergibt riesige Flächen – 1000 px Breite reichen fürs PDF.
  const f = Math.min(1, 1000 / bw);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(bw * f)); out.height = Math.max(1, Math.round(bh * f));
  out.getContext('2d')!.drawImage(c, x0, y0, bw, bh, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

export function SignaturePad({ onChange, height = 160, className = '' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zeichnet = useRef(false);
  const letzter = useRef<{ x: number; y: number } | null>(null);
  const [leer, setLeerState] = useState(true);
  // Der Größen-Beobachter unten braucht den aktuellen Stand, nicht den vom Einrichten.
  const leerRef = useRef(true);
  const setLeer = (x: boolean) => { leerRef.current = x; setLeerState(x); };

  // Canvas scharf halten – auch auf Handys mit hoher Pixeldichte.
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      // Vorhandene Striche beim Umbau (z. B. Handy gedreht) nicht verlieren.
      const alt = leerRef.current ? null : c.toDataURL();
      c.width = Math.round(w * dpr); c.height = Math.round(height * dpr);
      const ctx = c.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
      if (alt) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, w, height); img.src = alt; }
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(c);
    return () => ro.disconnect();
  }, [height]);

  const punkt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    zeichnet.current = true;
    letzter.current = punkt(e);
    // Ein einzelner Tupfer soll auch sichtbar sein (z. B. der Punkt auf dem i).
    const ctx = ref.current!.getContext('2d')!;
    ctx.beginPath(); ctx.arc(letzter.current.x, letzter.current.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
    setLeer(false);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!zeichnet.current || !letzter.current) return;
    e.preventDefault();
    const p = punkt(e);
    const ctx = ref.current!.getContext('2d')!;
    ctx.beginPath(); ctx.moveTo(letzter.current.x, letzter.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    letzter.current = p;
  };
  const ende = () => {
    if (!zeichnet.current) return;
    zeichnet.current = false; letzter.current = null;
    onChange(zugeschnitten(ref.current!));
  };
  const loeschen = () => {
    const c = ref.current!; const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    setLeer(true); onChange(null);
  };

  return (
    <div className={className}>
      <div className="relative rounded-lg border-2 border-dashed border-muted-foreground/40 bg-white">
        <canvas ref={ref} style={{ width: '100%', height, touchAction: 'none', display: 'block' }}
          onPointerDown={start} onPointerMove={move} onPointerUp={ende} onPointerCancel={ende} onPointerLeave={ende} />
        {leer && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Hier unterschreiben
          </span>
        )}
        <span className="pointer-events-none absolute left-4 right-4 bottom-8 border-b border-muted-foreground/30" />
      </div>
      <div className="flex justify-end mt-1">
        <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={loeschen} disabled={leer}>
          <Eraser className="w-3.5 h-3.5" /> Neu
        </Button>
      </div>
    </div>
  );
}
