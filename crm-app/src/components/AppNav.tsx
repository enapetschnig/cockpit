/**
 * DIE Navigation der App – eine einzige, überall gleiche Kopfzeile.
 *
 * Oben nur das Tägliche: Heute (Startseite), CRM, Buchhaltung, Angebote, Rechnungen, Wünsche, Apps.
 * Alles andere unter „Mehr", in Gruppen sortiert, damit man es findet.
 * Am Handy (unter 640 px, 03.11.2026) statt der Leiste oben eine Leiste unten mit dem, was man unterwegs braucht:
 * Heute, Apps, Wünsche, CRM – der Rest unter „Mehr“ (von unten). Editoren mit eigener Leiste unten ohne sie.
 *
 * Zähler zeigen, wo Arbeit wartet: überfällige Rechnungen (rot) an der
 * Buchhaltung, offene Wünsche (blau) an den Wünschen.
 */
import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { useOpenInvoices } from '@/hooks/useOpenInvoices';
import {
  Zap, LayoutGrid, Wallet, FileText, Receipt, Users, MessageSquare,
  MoreHorizontal, BarChart3, BookOpen, Archive, Package, Tag, Settings,
  ExternalLink, LogOut, TrendingUp, Megaphone, FileSignature, Wrench, Mic, FileWarning, Sun, Bot,
} from 'lucide-react';

const HAUPT = [
  { to: '/', label: 'Heute', icon: Sun },
  { to: '/crm', label: 'CRM', icon: LayoutGrid },
  { to: '/buchhaltung', label: 'Buchhaltung', icon: Wallet },
  { to: '/angebote-rechnung', label: 'Angebote', icon: FileText },
  { to: '/rechnungen', label: 'Rechnungen', icon: Receipt },
  { to: '/wuensche', label: 'Wünsche', icon: MessageSquare },
  { to: '/apps', label: 'Apps', icon: Bot },
];

/** Leiste unten am Handy – das Unterwegs-Wichtige; alles andere unter „Mehr“. */
const UNTEN = ['/', '/apps', '/wuensche', '/crm'];
/** Eigene Aktionsleiste unten – dort keine zweite darüber. */
const OHNE_LEISTE = /^\/(beleg|vertrag)\//;

/** „Mehr" – in Gruppen, damit man nicht sucht. */
const MEHR: { titel: string; eintraege: { to: string; label: string; icon: typeof Users }[] }[] = [
  { titel: 'Verkauf', eintraege: [
    { to: '/vertraege', label: 'Verträge', icon: FileSignature },
    { to: '/wartung', label: 'Wartungsverträge', icon: Wrench },
    { to: '/kunden', label: 'Kunden', icon: Users },
    { to: '/besprechungen', label: 'Besprechungen', icon: Mic },
    { to: '/kennzahlen', label: 'Kennzahlen', icon: BarChart3 },
    { to: '/auftragsvolumen', label: 'Auftragsvolumen', icon: TrendingUp },
  ] },
  { titel: 'Buchhaltung', eintraege: [
    { to: '/mahnwesen', label: 'Mahnwesen', icon: FileWarning },
    { to: '/kassabuch', label: 'Kassabuch', icon: BookOpen },
    { to: '/archiv', label: 'Archiv', icon: Archive },
    { to: '/export', label: 'Export für den Steuerberater', icon: Package },
  ] },
  { titel: 'Einstellungen', eintraege: [
    { to: '/firma', label: 'Firmendaten', icon: Settings },
    { to: '/angebote', label: 'Etiketten', icon: Tag },
  ] },
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
  const [mehrOffen, setMehrOffen] = useState(false);
  const mehrAktiv = MEHR.some((g) => g.eintraege.some((m) => aktiv(pathname, m.to)));

  return (
    <header className="bg-card border-b border-border sticky top-0 z-30">
      <div className="max-w-[1400px] mx-auto px-4 py-2.5 flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2 shrink-0" aria-label="Zur Startseite">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary text-primary-foreground">
            <Zap className="w-4 h-4" />
          </div>
          <span className="font-bold sm:hidden lg:inline">epower</span>
        </Link>

        <nav className="hidden sm:flex items-center gap-0.5 overflow-x-auto no-scrollbar" aria-label="Hauptnavigation">
          {HAUPT.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to}>
              <Button variant={aktiv(pathname, to) ? 'secondary' : 'ghost'} size="sm"
                className="gap-1.5 whitespace-nowrap px-2.5">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
                {to === '/buchhaltung' && <Zaehler wert={overdueCount} farbe="rot" />}
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
              {MEHR.map((g, gi) => (
                <div key={g.titel}>
                  {gi > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">{g.titel}</DropdownMenuLabel>
                  {g.eintraege.map(({ to, label, icon: Icon }) => (
                    <DropdownMenuItem key={to} asChild className={aktiv(pathname, to) ? 'bg-secondary' : ''}>
                      <Link to={to} className="gap-2 cursor-pointer">
                        <Icon className="w-4 h-4 text-muted-foreground" /> {label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Cockpit</DropdownMenuLabel>
              {/* Werbeanzeigen liegen im Cockpit (eigene App), nicht hier. */}
              <DropdownMenuItem asChild>
                <a href="https://cockpit-flax-tau.vercel.app/werbung" target="_blank" rel="noreferrer" className="gap-2 cursor-pointer">
                  <Megaphone className="w-4 h-4 text-muted-foreground" /> Werbeanzeigen
                </a>
              </DropdownMenuItem>
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
      {!OHNE_LEISTE.test(pathname) && <UntenLeiste pathname={pathname} overdue={overdueCount} signOut={signOut} />}
    </header>
  );
}

function UntenLeiste({ pathname, overdue, signOut }: { pathname: string; overdue: number; signOut: () => void }) {
  const [mehr, setMehr] = useState(false);
  // --unten (index.css) gilt nur, solange die Leiste da ist
  useEffect(() => {
    document.documentElement.classList.add('mit-leiste');
    return () => document.documentElement.classList.remove('mit-leiste');
  }, []);
  useEffect(() => { setMehr(false); }, [pathname]);
  const unten = UNTEN.map((to) => HAUPT.find((h) => h.to === to)!);
  const rest = HAUPT.filter((h) => !UNTEN.includes(h.to));
  const mehrAktiv = !unten.some((h) => aktiv(pathname, h.to));
  const knopf = 'flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] min-h-[3.75rem]';
  const eintrag = (to: string, label: string, Icon: typeof Users) => (
    <Link key={to} to={to} className={'flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] ' + (aktiv(pathname, to) ? 'bg-secondary font-medium' : 'hover:bg-muted')}>
      <Icon className="w-5 h-5 text-muted-foreground" /> {label}
      {to === '/buchhaltung' && <Zaehler wert={overdue} farbe="rot" />}
    </Link>
  );
  return (
    <>
      <nav aria-label="Navigation unten" className="sm:hidden fixed inset-x-0 bottom-0 z-30 bg-card border-t flex pb-[env(safe-area-inset-bottom)] print:hidden">
        {unten.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className={knopf + (aktiv(pathname, to) ? ' text-primary font-semibold' : ' text-muted-foreground')}>
            <Icon className="w-5 h-5" /> {label}
          </Link>
        ))}
        <button type="button" onClick={() => setMehr(true)} className={knopf + (mehrAktiv ? ' text-primary font-semibold' : ' text-muted-foreground')}>
          <span className="relative">
            <MoreHorizontal className="w-5 h-5" />
            {overdue > 0 && <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-red-500" />}
          </span>
          Mehr
        </button>
      </nav>
      <Sheet open={mehr} onOpenChange={setMehr}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader><SheetTitle className="text-left">Mehr</SheetTitle></SheetHeader>
          <div className="mt-2 space-y-3">
            <div>{rest.map(({ to, label, icon }) => eintrag(to, label, icon))}</div>
            {MEHR.map((g) => (
              <div key={g.titel}>
                <div className="px-3 text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{g.titel}</div>
                {g.eintraege.map(({ to, label, icon }) => eintrag(to, label, icon))}
              </div>
            ))}
            <button type="button" onClick={signOut} className="w-full flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] hover:bg-muted">
              <LogOut className="w-5 h-5 text-muted-foreground" /> Abmelden
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
