import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Settings2 } from 'lucide-react';
import type { LeadPhase } from '@/hooks/useLeadPhasen';

interface PhasenPickerProps {
  phasen: LeadPhase[];
  aktuell: string;
  onChange: (schluessel: string) => void;
  onBearbeiten?: () => void;
}

/** Spalte direkt auf der Lead-Karte wechseln – wie das Etikett, ohne den Lead aufzumachen. */
export function PhasenPicker({ phasen, aktuell, onChange, onBearbeiten }: PhasenPickerProps) {
  const jetzt = phasen.find((p) => p.schluessel === aktuell);
  const stopp = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div onClick={stopp}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-border bg-background text-foreground hover:border-foreground/40 transition-all"
            title="In andere Spalte verschieben"
          >
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: jetzt?.farbe ?? '#64748b' }} />
            <span className="truncate max-w-[120px]">{jetzt?.name ?? aktuell}</span>
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={stopp}>
          {phasen.map((p) => (
            <DropdownMenuItem key={p.schluessel} onClick={() => p.schluessel !== aktuell && onChange(p.schluessel)} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: p.farbe }} />
              <span className={`flex-1 ${p.ausgeblendet ? 'text-muted-foreground' : ''}`}>{p.name}</span>
              {p.schluessel === aktuell && <span className="text-xs text-muted-foreground">✓</span>}
            </DropdownMenuItem>
          ))}
          {onBearbeiten && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onBearbeiten} className="text-xs">
                <Settings2 className="w-3.5 h-3.5 mr-2" />
                Spalten bearbeiten
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
