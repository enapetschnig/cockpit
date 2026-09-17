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

export function SignaturePad({ onChange, height = 160, className = '' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zeichnet = useRef(false);
  const letzter = useRef<{ x: number; y: number } | null>(null);
  const [leer, setLeer] = useState(true);

  // Canvas scharf halten – auch auf Handys mit hoher Pixeldichte.
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      // Vorhandene Striche beim Umbau nicht verlieren.
      const alt = leer ? null : c.toDataURL();
      c.width = Math.round(w * dpr); c.height = Math.round(height * dpr);
      const ctx = c.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
      if (alt) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, w, height); img.src = alt; }
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    onChange(ref.current!.toDataURL('image/png'));
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
