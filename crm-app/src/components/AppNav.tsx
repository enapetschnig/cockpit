/**
 * DIE Navigation der App – eine einzige, überall gleiche Kopfzeile.
 *
 * Vorher hatte die App zwei Gesichter: die CRM-Seiten einen Kopf, die
 * Buchhaltung einen anderen, mit anderen Punkten in anderer Reihenfolge.
 * Jetzt: sechs Hauptbereiche, alles Seltenere unter „Mehr", Abmelden auch.
 *
 * Zähler zeigen, wo Arbeit wartet: überfällige Rechnungen (rot) an der
 * Buchhaltung, offene Wünsche (blau) an den Wünschen.
 */
import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { useOpenInvoices } from '@/hooks/useOpenInvoices';
import { useOffeneWuensche } from '@/hooks/useOffeneWuensche';
import {
  Zap, LayoutGrid, Wallet, FileText, Receipt, Users, MessageSquare,
  MoreHorizontal, BarChart3, BookOpen, Archive, Package, Tag, Settings,
  ExternalLink, LogOut, TrendingUp,
} from 'lucide-react';

const HAUPT = [
  { to: '/', label: 'Pipeline', icon: LayoutGrid },
  { to: '/buchhaltung', label: 'Buchhaltung', icon: Wallet },
  { to: '/angebote-rechnung', label: 'Angebote', icon: FileText },
  { to: '/rechnungen', label: 'Rechnungen', icon: Receipt },
  { to: '/kunden', label: 'Kunden', icon: Users },
  { to: '/wuensche', label: 'Wünsche', icon: MessageSquare },
];

const MEHR = [
  { to: '/kennzahlen', label: 'Kennzahlen', icon: BarChart3 },
  { to: '/kassabuch', label: 'Kassabuch', icon: BookOpen },
  { to: '/archiv', label: 'Archiv', icon: Archive },
  { to: '/export', label: 'Export für den Steuerberater', icon: Package },
  { to: '/auftragsvolumen', label: 'Auftragsvolumen', icon: TrendingUp },
  { to: '/angebote', label: 'Etiketten', icon: Tag },
  { to: '/firma', label: 'Firmendaten', icon: Settings },
];

/** Aktiv = genau diese Seite oder eine Unterseite davon. */
const aktiv = (pathname: string, to: string) =>
  to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/');

function Zaehler({ wert, farbe }: { wert: number; farbe: 'rot' | 'blau' }) {
  if (!wert) return null;
  return (
    <span className={'text-[10px] font-bold text-white rounded-full px-1.5 py-0.5 leading-none ' +
      (farbe === 'rot' ? 'bg-red-500' : 'bg-blue-600')}>
      {wert}
    </span>
  );
}

/** `children` landet rechts außen – für seitenspezifische Aktionen wie „Neuer Lead". */
export function AppNav({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const { overdueCount } = useOpenInvoices();
  const { anzahl: offeneWuensche } = useOffeneWuensche();
  const [mehrOffen, setMehrOffen] = useState(false);
  const mehrAktiv = MEHR.some((m) => aktiv(pathname, m.to));

  return (
    <header className="bg-card border-b border-border sticky top-0 z-30">
      <div className="max-w-[1400px] mx-auto px-4 py-2.5 flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="Zur Pipeline">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary text-primary-foreground">
            <Zap className="w-4 h-4" />
          </div>
          <span className="font-bold hidden lg:inline">epower</span>
        </Link>

        <nav className="flex items-center gap-0.5 overflow-x-auto no-scrollbar" aria-label="Hauptnavigation">
          {HAUPT.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to}>
              <Button variant={aktiv(pathname, to) ? 'secondary' : 'ghost'} size="sm"
                className="gap-1.5 whitespace-nowrap px-2.5">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
                {to === '/buchhaltung' && <Zaehler wert={overdueCount} farbe="rot" />}
                {to === '/wuensche' && <Zaehler wert={offeneWuensche} farbe="blau" />}
              </Button>
            </Link>
          ))}

          <DropdownMenu open={mehrOffen} onOpenChange={setMehrOffen}>
            <DropdownMenuTrigger asChild>
              <Button variant={mehrAktiv ? 'secondary' : 'ghost'} size="sm"
                className="gap-1.5 whitespace-nowrap px-2.5" aria-label="Weitere Bereiche">
                <MoreHorizontal className="w-4 h-4" />
                <span className="hidden md:inline">Mehr</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {MEHR.map(({ to, label, icon: Icon }) => (
                <DropdownMenuItem key={to} asChild className={aktiv(pathname, to) ? 'bg-secondary' : ''}>
                  <Link to={to} className="gap-2 cursor-pointer">
                    <Icon className="w-4 h-4 text-muted-foreground" /> {label}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href="https://cockpit-flax-tau.vercel.app" target="_blank" rel="noreferrer" className="gap-2 cursor-pointer">
                  <ExternalLink className="w-4 h-4 text-muted-foreground" /> Cockpit öffnen
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="gap-2 cursor-pointer">
                <LogOut className="w-4 h-4 text-muted-foreground" /> Abmelden
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        {children && <div className="ml-auto shrink-0 flex items-center gap-2">{children}</div>}
      </div>
    </header>
  );
}
