import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Zap, FileText, Receipt, Users, BookOpen, Archive, Settings, LayoutGrid, ExternalLink } from 'lucide-react';

const ITEMS = [
  { to: '/', label: 'Pipeline', icon: LayoutGrid },
  { to: '/angebote-rechnung', label: 'Angebote', icon: FileText },
  { to: '/rechnungen', label: 'Rechnungen', icon: Receipt },
  { to: '/kunden', label: 'Kunden', icon: Users },
  { to: '/kassabuch', label: 'Kassabuch', icon: BookOpen },
  { to: '/archiv', label: 'Archiv', icon: Archive },
  { to: '/firma', label: 'Firma', icon: Settings },
];

/** Navigation für den Buchhaltungsbereich – inkl. Cockpit als Menüpunkt. */
export function BillingNav() {
  const { pathname } = useLocation();
  return (
    <header className="bg-card border-b border-border sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary text-primary-foreground">
            <Zap className="w-4 h-4" />
          </div>
          <div className="hidden sm:block leading-tight">
            <div className="font-bold">epower CRM</div>
            <div className="text-[11px] text-muted-foreground">Angebote & Buchhaltung</div>
          </div>
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {ITEMS.map(({ to, label, icon: Icon }) => {
            const active = to === '/' ? pathname === '/' : pathname.startsWith(to);
            return (
              <Link key={to} to={to}>
                <Button variant={active ? 'secondary' : 'ghost'} size="sm" className="gap-1.5 whitespace-nowrap">
                  <Icon className="w-4 h-4" /> <span className="hidden sm:inline">{label}</span>
                </Button>
              </Link>
            );
          })}
          <a href="https://cockpit-flax-tau.vercel.app" target="_blank" rel="noreferrer">
            <Button variant="ghost" size="sm" className="gap-1.5 whitespace-nowrap text-muted-foreground">
              <ExternalLink className="w-4 h-4" /> <span className="hidden sm:inline">Cockpit</span>
            </Button>
          </a>
        </nav>
      </div>
    </header>
  );
}
