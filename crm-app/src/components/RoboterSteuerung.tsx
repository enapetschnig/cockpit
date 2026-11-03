/**
 * Fernbedienung für den Roboter: läuft er, woran arbeitet er, Pause/Weiter – für alle Apps oder eine.
 * Der Befehl geht über crm.roboter_befehle; der Roboter führt ihn binnen Sekunden aus.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { roboterPuls } from '@/lib/heute';
import { APP_LABEL } from '@/lib/apps';
import { pausiertBis, roboterBefehl, uhrzeit, type Puls } from '@/lib/sitzungen';
import { Loader2, Pause, Play } from 'lucide-react';

export function RoboterSteuerung({ puls, appKey, onBefehl }: { puls: Puls | null; appKey?: string; onBefehl: () => void }) {
  const [sendet, setSendet] = useState(false);
  const p = roboterPuls(puls?.zuletzt);
  const key = appKey ?? 'alle';
  const bis = pausiertBis(puls?.pausen, key);
  const nurAlle = !!appKey && !!bis && !pausiertBis({ [key]: puls?.pausen?.[key] ?? '' }, key);   // pausiert nur über „alle“
  const arbeitet = (puls?.laeuft ?? []).filter((x) => !appKey || x.app === appKey);

  const senden = async (befehl: 'pause' | 'weiter', minuten?: number, ziel = key) => {
    setSendet(true);
    try {
      await roboterBefehl(befehl, ziel, minuten);
      toast.success(befehl === 'pause' ? `Pausiert für ${minuten! >= 60 ? `${minuten! / 60} Std.` : `${minuten} Min.`}` : 'Läuft wieder');
      // Der Roboter fragt alle 4 s nach – dann steht es im Puls
      setTimeout(onBefehl, 5000);
      setTimeout(() => setSendet(false), 5000);
    } catch {
      toast.error('Konnte nicht an den Roboter geschickt werden');
      setSendet(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className={'inline-block w-2.5 h-2.5 rounded-full ' + (!p.laeuft ? 'bg-red-500' : bis ? 'bg-amber-500' : 'bg-green-600')} />
        <span className="font-medium">
          {!p.laeuft
            ? p.minuten === null ? 'Roboter noch nie gestartet' : `Roboter steht – seit ${p.minuten >= 120 ? `${Math.round(p.minuten / 60)} Std.` : `${p.minuten} Min.`} kein Lebenszeichen (Devbox aus?)`
            : bis ? `${appKey ? 'Für diese App pausiert' : 'Alles pausiert'} bis ${uhrzeit(bis)}` : appKey ? 'Roboter arbeitet hier mit' : 'Roboter läuft'}
        </span>
      </div>
      {arbeitet.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-0.5">
          {arbeitet.map((x) => (
            <li key={x.app} className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              <span className="truncate">{x.was || APP_LABEL[x.app] || x.app}</span>
            </li>
          ))}
        </ul>
      )}
      {p.laeuft && (
        <div className="flex flex-wrap gap-2">
          {bis ? (
            <Button size="sm" variant="outline" className="h-9 gap-1.5" disabled={sendet}
              onClick={() => senden('weiter', undefined, nurAlle ? 'alle' : key)}>
              <Play className="w-3.5 h-3.5" /> {nurAlle ? 'Alle wieder starten' : 'Weiter'}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" className="h-9 gap-1.5" disabled={sendet} onClick={() => senden('pause', 60)}>
                <Pause className="w-3.5 h-3.5" /> {appKey ? '1 Std. pausieren' : 'Alle 1 Std. pausieren'}
              </Button>
              <Button size="sm" variant="ghost" className="h-9" disabled={sendet} onClick={() => senden('pause', 240)}>4 Std.</Button>
            </>
          )}
        </div>
      )}
      {appKey && (
        <p className="text-[11px] text-muted-foreground">
          Pause gilt für die Aufträge aus Kundenwünschen (z. B. während du selbst in VS Code daran arbeitest). Was du hier am Handy schreibst, läuft trotzdem.
        </p>
      )}
    </div>
  );
}
