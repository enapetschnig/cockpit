import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ArrowUp, ArrowDown, Eye, EyeOff, Trash2, Plus } from 'lucide-react';
import { PHASEN_FARBEN, type LeadPhase, type useLeadPhasen } from '@/hooks/useLeadPhasen';

type Phasen = ReturnType<typeof useLeadPhasen>;

interface PhasenEditorProps extends Phasen {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Anzahl Leads je Spalte (fürs Löschen: wohin damit) */
  anzahl: Record<string, number>;
  /** nach dem Löschen: Leads neu laden, weil sie die Spalte gewechselt haben */
  onLeadsVerschoben: () => void;
}

function FarbWahl({ farbe, onChange }: { farbe: string; onChange: (f: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="w-6 h-6 rounded-full border-2 border-background ring-1 ring-border flex-shrink-0" style={{ backgroundColor: farbe }} title="Farbe" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="p-2">
        <div className="grid grid-cols-6 gap-1.5">
          {PHASEN_FARBEN.map((f) => (
            <button key={f} type="button" onClick={() => onChange(f)}
              className={`w-6 h-6 rounded-full ${f === farbe ? 'ring-2 ring-offset-1 ring-foreground' : ''}`} style={{ backgroundColor: f }} />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Zeile({ p, erste, letzte, anzahl, andere, aendern, verschieben, loeschen, onLeadsVerschoben }: {
  p: LeadPhase; erste: boolean; letzte: boolean; anzahl: number; andere: LeadPhase[];
  onLeadsVerschoben: () => void;
} & Pick<Phasen, 'aendern' | 'verschieben' | 'loeschen'>) {
  const [name, setName] = useState(p.name);
  const [loeschenFrage, setLoeschenFrage] = useState(false);
  const [ziel, setZiel] = useState(andere[0]?.schluessel ?? 'new');
  const namenSpeichern = () => {
    const n = name.trim();
    if (!n) setName(p.name);
    else if (n !== p.name) aendern(p.schluessel, { name: n });
  };

  return (
    <div className={`rounded-md border p-2 ${p.ausgeblendet ? 'bg-muted/40' : 'bg-card'}`}>
      <div className="flex items-center gap-2">
        <FarbWahl farbe={p.farbe} onChange={(farbe) => aendern(p.schluessel, { farbe })} />
        <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={namenSpeichern}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={`h-8 ${p.ausgeblendet ? 'text-muted-foreground' : ''}`} />
        <span className="text-xs text-muted-foreground w-6 text-right tabular-nums" title="Leads in dieser Spalte">{anzahl}</span>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={erste} onClick={() => verschieben(p.schluessel, -1)} title="Nach vorne"><ArrowUp className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={letzte} onClick={() => verschieben(p.schluessel, 1)} title="Nach hinten"><ArrowDown className="w-4 h-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => aendern(p.schluessel, { ausgeblendet: !p.ausgeblendet })}
          title={p.ausgeblendet ? 'Wieder anzeigen' : 'Ausblenden (Leads bleiben drin)'}>
          {p.ausgeblendet ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4" />}
        </Button>
        {p.fest
          ? <span className="w-8" title="Feste Spalte – Kennzahlen rechnen damit, darum nur ausblenden" />
          : <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setLoeschenFrage(true)} title="Spalte löschen"><Trash2 className="w-4 h-4" /></Button>}
      </div>
      {loeschenFrage && (
        <div className="flex items-center gap-2 flex-wrap mt-2 pl-8 text-sm">
          {anzahl > 0 ? (
            <>
              <span>{anzahl} {anzahl === 1 ? 'Lead kommt' : 'Leads kommen'} nach</span>
              <Select value={ziel} onValueChange={setZiel}>
                <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>{andere.map((a) => <SelectItem key={a.schluessel} value={a.schluessel}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </>
          ) : <span>Spalte „{p.name}“ löschen?</span>}
          <Button size="sm" variant="destructive" className="h-8" onClick={async () => {
            if (await loeschen(p.schluessel, ziel) && anzahl > 0) onLeadsVerschoben();
          }}>Löschen</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setLoeschenFrage(false)}>Abbrechen</Button>
        </div>
      )}
    </div>
  );
}

/** Spalten der Lead-Pipeline umbenennen, umfärben, umsortieren, ausblenden, neu anlegen, löschen. */
export function PhasenEditor({ open, onOpenChange, anzahl, onLeadsVerschoben, phasen, aendern, verschieben, anlegen, loeschen }: PhasenEditorProps) {
  const [neuName, setNeuName] = useState('');
  const [neuFarbe, setNeuFarbe] = useState(PHASEN_FARBEN[10]);
  const hinzufuegen = async () => {
    if (!neuName.trim()) return;
    await anlegen(neuName.trim(), neuFarbe);
    setNeuName('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pipeline-Spalten</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {phasen.map((p, i) => (
            <Zeile key={p.schluessel} p={p} erste={i === 0} letzte={i === phasen.length - 1} anzahl={anzahl[p.schluessel] ?? 0}
              andere={phasen.filter((x) => x.schluessel !== p.schluessel)}
              aendern={aendern} verschieben={verschieben} loeschen={loeschen} onLeadsVerschoben={onLeadsVerschoben} />
          ))}
        </div>
        <div className="flex items-center gap-2 pt-3 border-t">
          <FarbWahl farbe={neuFarbe} onChange={setNeuFarbe} />
          <Input value={neuName} onChange={(e) => setNeuName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && hinzufuegen()}
            placeholder="Neue Spalte, z. B. Angebot geschickt" className="h-8" />
          <Button size="sm" className="h-8 gap-1" onClick={hinzufuegen} disabled={!neuName.trim()}><Plus className="w-4 h-4" /> Anlegen</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Ausgeblendete Spalten zeigt die Pipeline mit „Ausgeblendete anzeigen“. Die bisherigen Spalten lassen sich nur ausblenden, weil Kennzahlen damit rechnen.
        </p>
      </DialogContent>
    </Dialog>
  );
}
