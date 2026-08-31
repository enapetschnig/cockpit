/**
 * Kopf der CRM-Seiten (Pipeline, Kennzahlen, …): die gemeinsame Navigation
 * plus eine ruhige Zahlenleiste darunter – Leads, Verkäufe, offene
 * Rechnungen, Auftragsvolumen. Früher standen diese Zahlen riesig in der
 * Kopfzeile selbst; jetzt tragen sie leise Information statt laut Dekor.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppNav } from '@/components/AppNav';
import { useCurrentYearTotal } from '@/hooks/useOrderVolumes';
import { useOpenInvoices } from '@/hooks/useOpenInvoices';

interface HeaderProps {
  onAddLead: () => void;
  leadCount: number;
  wonCount: number;
  totalRevenue: number;
}

function Wert({ zahl, label, klasse }: { zahl: string; label: string; klasse?: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className={'font-semibold tabular-nums ' + (klasse ?? 'text-foreground')}>{zahl}</span>
      <span className="text-muted-foreground"> {label}</span>
    </span>
  );
}

export function Header({ onAddLead, leadCount, wonCount }: HeaderProps) {
  const yearlyOrderVolume = useCurrentYearTotal();
  const { openSum, openCount, overdueCount } = useOpenInvoices();

  // Auftragsvolumen lässt sich ausblenden – man hat nicht immer Lust, die Zahl
  // jedem zu zeigen, der auf den Bildschirm schaut. Merker bleibt im Browser.
  const [zeigeVolumen, setZeigeVolumen] = useState(() => {
    try { return localStorage.getItem('volumen-verbergen') !== '1'; } catch { return true; }
  });
  const volumenUmschalten = () => {
    setZeigeVolumen((v) => {
      try { localStorage.setItem('volumen-verbergen', v ? '1' : '0'); } catch { /* egal */ }
      return !v;
    });
  };

  return (
    <>
      <AppNav>
        <Button size="sm" onClick={onAddLead} className="gap-1.5">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Neuer Lead</span>
        </Button>
      </AppNav>

      <div className="bg-card/60 border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 py-1.5 flex items-center gap-4 text-sm overflow-x-auto no-scrollbar">
          <Wert zahl={String(leadCount)} label="Leads" />
          <Wert zahl={String(wonCount)} label="Verkäufe" klasse="text-success" />
          <Link to="/buchhaltung" className="hover:opacity-75 transition-opacity">
            <Wert
              zahl={`${openSum.toLocaleString('de-AT', { maximumFractionDigits: 0 })} €`}
              label={`offen (${openCount})`}
              klasse={overdueCount > 0 ? 'text-red-600' : 'text-foreground'}
            />
          </Link>
          <span className="flex items-center gap-1 whitespace-nowrap group">
            {zeigeVolumen ? (
              <Link to="/auftragsvolumen" className="hover:opacity-75 transition-opacity">
                <Wert zahl={`${yearlyOrderVolume.toLocaleString('de-DE')} €`} label="Auftragsvolumen" />
              </Link>
            ) : (
              <Wert zahl="••••" label="Auftragsvolumen" klasse="text-muted-foreground tracking-widest select-none" />
            )}
            <button
              type="button"
              onClick={volumenUmschalten}
              title={zeigeVolumen ? 'Auftragsvolumen ausblenden' : 'Auftragsvolumen einblenden'}
              aria-label={zeigeVolumen ? 'Auftragsvolumen ausblenden' : 'Auftragsvolumen einblenden'}
              className={'text-muted-foreground hover:text-foreground transition-opacity ' +
                (zeigeVolumen ? 'opacity-0 group-hover:opacity-100 focus:opacity-100' : 'opacity-100')}
            >
              {zeigeVolumen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </span>
        </div>
      </div>
    </>
  );
}
