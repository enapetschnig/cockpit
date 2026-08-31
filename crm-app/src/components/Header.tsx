import { Zap, Plus, BarChart3, LogOut, Euro, Mail, Tag, Wallet, Receipt, FileText, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentYearTotal } from '@/hooks/useOrderVolumes';
import { useOpenInvoices } from '@/hooks/useOpenInvoices';
import { useOffeneWuensche } from '@/hooks/useOffeneWuensche';

interface HeaderProps {
  onAddLead: () => void;
  leadCount: number;
  wonCount: number;
  totalRevenue: number;
}

export function Header({ onAddLead, leadCount, wonCount, totalRevenue }: HeaderProps) {
  const location = useLocation();
  const isStatistics = location.pathname === '/kennzahlen';
  const isOrderVolume = location.pathname === '/auftragsvolumen';
  const isDmc = location.pathname === '/dmc';
  const isOffers = location.pathname === '/angebote';
  const { signOut } = useAuth();
  const yearlyOrderVolume = useCurrentYearTotal();
  const { openSum, openCount, overdueCount } = useOpenInvoices();
  const { anzahl: offeneWuensche } = useOffeneWuensche();

  return (
    <header className="bg-card border-b border-border px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">epower CRM</h1>
              <p className="text-sm text-muted-foreground">Lead Management</p>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1 ml-4">
            <Link to="/">
              <Button
                variant={!isStatistics && !isOrderVolume && !isDmc && !isOffers ? "secondary" : "ghost"}
                size="sm"
              >
                Pipeline
              </Button>
            </Link>
            <Link to="/kennzahlen">
              <Button 
                variant={isStatistics ? "secondary" : "ghost"} 
                size="sm"
                className="gap-2"
              >
                <BarChart3 className="w-4 h-4" />
                Kennzahlen
              </Button>
            </Link>
            <Link to="/buchhaltung">
              <Button variant={location.pathname.startsWith('/buchhaltung') ? "secondary" : "ghost"} size="sm" className="gap-2">
                <Wallet className="w-4 h-4" />
                Buchhaltung
                {overdueCount > 0 && (
                  <span className="ml-1 text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5">{overdueCount}</span>
                )}
              </Button>
            </Link>
            <Link to="/rechnungen">
              <Button variant={location.pathname.startsWith('/rechnungen') ? "secondary" : "ghost"} size="sm" className="gap-2">
                <Receipt className="w-4 h-4" />
                Rechnungen
              </Button>
            </Link>
            <Link to="/angebote">
              <Button
                variant={isOffers ? "secondary" : "ghost"}
                size="sm"
                className="gap-2"
              >
                <Tag className="w-4 h-4" />
                Angebote
              </Button>
            </Link>
            <Link to="/wuensche">
              <Button variant={location.pathname.startsWith('/wuensche') ? "secondary" : "ghost"} size="sm" className="gap-2">
                <MessageSquare className="w-4 h-4" />
                Wünsche
                {offeneWuensche > 0 && (
                  <span className="ml-1 text-[10px] font-bold bg-blue-600 text-white rounded-full px-1.5 py-0.5">{offeneWuensche}</span>
                )}
              </Button>
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-6 text-sm">
            <div className="text-center">
              <p className="text-2xl font-bold text-foreground">{leadCount}</p>
              <p className="text-muted-foreground">Leads</p>
            </div>
            <div className="w-px h-10 bg-border" />
            <div className="text-center">
              <p className="text-2xl font-bold text-success">{wonCount}</p>
              <p className="text-muted-foreground">Verkäufe</p>
            </div>
            <div className="w-px h-10 bg-border" />
            <Link to="/buchhaltung" className="text-center hover:opacity-80 transition-opacity">
              <p className={`text-2xl font-bold ${overdueCount > 0 ? 'text-red-600' : 'text-foreground'}`}>
                {openSum.toLocaleString('de-AT', { maximumFractionDigits: 0 })} €
              </p>
              <p className="text-muted-foreground">offen ({openCount})</p>
            </Link>
            <div className="w-px h-10 bg-border" />
            <Link to="/auftragsvolumen" className="text-center hover:opacity-80 transition-opacity">
              <p className="text-2xl font-bold text-foreground">{yearlyOrderVolume.toLocaleString('de-DE')} €</p>
              <p className="text-muted-foreground">Auftragsvolumen netto</p>
            </Link>
          </div>

          <Link to="/beleg/neu?kind=invoice" className="hidden sm:block">
            <Button variant="outline" className="gap-2">
              <FileText className="w-4 h-4" />
              Rechnung
            </Button>
          </Link>
          <Link to="/buchhaltung" className="md:hidden">
            <Button variant="outline" size="icon" className="relative" title="Buchhaltung">
              <Wallet className="w-4 h-4" />
              {overdueCount > 0 && (
                <span className="absolute -top-1 -right-1 text-[9px] font-bold bg-red-500 text-white rounded-full px-1">{overdueCount}</span>
              )}
            </Button>
          </Link>
          <Link to="/wuensche" className="md:hidden">
            <Button variant="outline" size="icon" className="relative" title="Wünsche aus den Apps">
              <MessageSquare className="w-4 h-4" />
              {offeneWuensche > 0 && (
                <span className="absolute -top-1 -right-1 text-[9px] font-bold bg-blue-600 text-white rounded-full px-1">{offeneWuensche}</span>
              )}
            </Button>
          </Link>
          <Button onClick={onAddLead} className="gap-2">
            <Plus className="w-4 h-4" />
            Neuer Lead
          </Button>

          <Button variant="ghost" size="icon" onClick={signOut} title="Ausloggen">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}