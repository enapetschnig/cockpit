import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BillingNav } from '@/components/billing/BillingNav';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useDocuments } from '@/hooks/useBilling';
import { DOC_KIND_LABEL, DOC_STATUS_LABEL, eur, fmtDate, type BillingDocument } from '@/types/billing';
import {
  AlertTriangle, ArrowRight, Clock, FileText, Plus, Receipt, TrendingUp, Wallet, CheckCircle2,
} from 'lucide-react';

const isOpen = (d: BillingDocument) => !['paid', 'cancelled', 'rejected'].includes(d.status);
const overdue = (d: BillingDocument) => isOpen(d) && !!d.due_date && new Date(d.due_date) < new Date();
const daysLate = (d: BillingDocument) =>
  d.due_date ? Math.floor((Date.now() - new Date(d.due_date).getTime()) / 86400000) : 0;

function Kpi({ label, value, sub, icon: Icon, tone = 'default', to }: {
  label: string; value: string; sub?: string; icon: React.ElementType; tone?: 'default' | 'warn' | 'good'; to?: string;
}) {
  const tones = {
    default: 'bg-card', warn: 'bg-red-50 border-red-200', good: 'bg-emerald-50 border-emerald-200',
  };
  const inner = (
    <Card className={`p-4 h-full ${tones[tone]} ${to ? 'hover:border-primary transition-colors' : ''}`}>
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
        <Icon className="w-4 h-4" /> {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export default function BuchhaltungPage() {
  const { documents: invoices, isLoading } = useDocuments(['invoice', 'partial_invoice', 'final_invoice', 'credit_note']);
  const { documents: offers } = useDocuments(['offer']);
  const navigate = useNavigate();

  const s = useMemo(() => {
    const year = new Date().getFullYear();
    const thisYear = invoices.filter((d) => d.doc_date?.startsWith(String(year)) && d.status !== 'cancelled');
    const open = invoices.filter(isOpen);
    const late = open.filter(overdue).sort((a, b) => daysLate(b) - daysLate(a));
    const openOffers = offers.filter((o) => ['draft', 'sent'].includes(o.status));
    const month = new Date().toISOString().slice(0, 7);
    return {
      yearSum: thisYear.reduce((a, d) => a + Number(d.gross || 0), 0),
      monthSum: thisYear.filter((d) => d.doc_date?.startsWith(month)).reduce((a, d) => a + Number(d.gross || 0), 0),
      open, openSum: open.reduce((a, d) => a + Number(d.gross || 0), 0),
      late, lateSum: late.reduce((a, d) => a + Number(d.gross || 0), 0),
      openOffers, offerSum: openOffers.reduce((a, d) => a + Number(d.gross || 0), 0),
      recent: [...invoices].slice(0, 6),
      year,
    };
  }, [invoices, offers]);

  const Row = ({ d, showLate }: { d: BillingDocument; showLate?: boolean }) => (
    <Link to={`/beleg/${d.id}`}>
      <div className="flex items-center gap-3 py-2.5 px-3 hover:bg-muted/60 rounded-lg">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            {d.number || '—'} · {d.recipient_company || d.recipient_name || '—'}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {d.title || DOC_KIND_LABEL[d.kind]} · {fmtDate(d.doc_date)}
            {d.due_date && ` · fällig ${fmtDate(d.due_date)}`}
          </div>
        </div>
        {showLate && daysLate(d) > 0 && (
          <Badge variant="outline" className="text-[10px] border-red-300 text-red-600 shrink-0">
            {daysLate(d)} Tage überfällig
          </Badge>
        )}
        <div className="text-right shrink-0">
          <div className="font-semibold text-sm">{eur(Number(d.gross))}</div>
          <div className="text-[11px] text-muted-foreground">{DOC_STATUS_LABEL[d.status]}</div>
        </div>
      </div>
    </Link>
  );

  return (
    <div className="min-h-screen bg-background">
      <BillingNav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold">Buchhaltung</h1>
            <p className="text-sm text-muted-foreground">Offene Posten, Umsatz und alle Belege auf einen Blick</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => navigate('/beleg/neu?kind=offer')}>
              <FileText className="w-4 h-4" /> Angebot
            </Button>
            <Button className="gap-2" onClick={() => navigate('/beleg/neu?kind=invoice')}>
              <Plus className="w-4 h-4" /> Rechnung
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          <Kpi label="Offene Rechnungen" value={eur(s.openSum)} sub={`${s.open.length} Belege`} icon={Wallet} to="/rechnungen" />
          <Kpi label="Überfällig" value={eur(s.lateSum)} sub={`${s.late.length} Belege`} icon={AlertTriangle}
               tone={s.late.length ? 'warn' : 'default'} to="/rechnungen" />
          <Kpi label={`Umsatz ${s.year}`} value={eur(s.yearSum)} sub="brutto, ohne Storno" icon={TrendingUp} />
          <Kpi label="Diesen Monat" value={eur(s.monthSum)} icon={Clock} />
          <Kpi label="Offene Angebote" value={eur(s.offerSum)} sub={`${s.openOffers.length} Angebote`} icon={FileText} to="/angebote-rechnung" />
        </div>

        {isLoading ? <p className="text-muted-foreground">Laden …</p> : (
          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" /> Überfällig
                </h2>
                <Link to="/rechnungen"><Button variant="ghost" size="sm" className="gap-1">Alle <ArrowRight className="w-3 h-3" /></Button></Link>
              </div>
              {s.late.length === 0 ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2 py-6 justify-center">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Nichts überfällig – alles im grünen Bereich
                </p>
              ) : s.late.slice(0, 8).map((d) => <Row key={d.id} d={d} showLate />)}
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold flex items-center gap-2"><Wallet className="w-4 h-4" /> Offene Posten</h2>
                <Link to="/rechnungen"><Button variant="ghost" size="sm" className="gap-1">Alle <ArrowRight className="w-3 h-3" /></Button></Link>
              </div>
              {s.open.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Keine offenen Rechnungen</p>
              ) : s.open.slice(0, 8).map((d) => <Row key={d.id} d={d} />)}
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> Offene Angebote</h2>
                <Link to="/angebote-rechnung"><Button variant="ghost" size="sm" className="gap-1">Alle <ArrowRight className="w-3 h-3" /></Button></Link>
              </div>
              {s.openOffers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Keine offenen Angebote</p>
              ) : s.openOffers.slice(0, 8).map((d) => <Row key={d.id} d={d} />)}
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold flex items-center gap-2"><Receipt className="w-4 h-4" /> Zuletzt</h2>
                <Link to="/rechnungen"><Button variant="ghost" size="sm" className="gap-1">Alle <ArrowRight className="w-3 h-3" /></Button></Link>
              </div>
              {s.recent.map((d) => <Row key={d.id} d={d} />)}
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
