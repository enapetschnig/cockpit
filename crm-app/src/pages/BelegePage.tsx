import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BillingNav } from '@/components/billing/BillingNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useDocuments } from '@/hooks/useBilling';
import { DOC_KIND_LABEL, DOC_STATUS_LABEL, eur, fmtDate, type DocKind, type DocStatus } from '@/types/billing';
import { FileText, Plus, Search, Receipt } from 'lucide-react';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  paid: 'bg-emerald-100 text-emerald-700',
  partly_paid: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-muted text-muted-foreground line-through',
};

export default function BelegePage({ mode }: { mode: 'offer' | 'invoice' }) {
  const kinds: DocKind[] = mode === 'offer' ? ['offer'] : ['invoice', 'partial_invoice', 'final_invoice', 'credit_note'];
  const { documents, isLoading } = useDocuments(kinds);
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  // Rechnungen starten mit den OFFENEN Posten – genau das will man zuerst sehen.
  const initial = (sp.get('f') as 'offen' | 'overdue' | 'alle') || (mode === 'invoice' ? 'offen' : 'alle');
  const [view, setView] = useState<'offen' | 'overdue' | 'alle'>(initial);
  const [status, setStatus] = useState<DocStatus | 'alle'>('alle');
  const navigate = useNavigate();
  const isOverdue = (d: { status: string; due_date: string | null }) =>
    !['paid', 'cancelled', 'rejected'].includes(d.status) && !!d.due_date && new Date(d.due_date) < new Date();
  const daysLate = (d?: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return documents.filter((d) => {
      if (view === 'offen' && ['paid', 'cancelled', 'rejected'].includes(d.status)) return false;
      if (view === 'overdue' && !isOverdue(d)) return false;
      if (status !== 'alle' && d.status !== status) return false;
      if (!s) return true;
      return [d.number, d.recipient_name, d.recipient_company, d.title]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
    });
  }, [documents, q, status, view]);

  const sum = useMemo(() => {
    const open = list.filter((d) => !['paid', 'cancelled', 'rejected'].includes(d.status));
    return {
      total: list.reduce((a, d) => a + Number(d.gross || 0), 0),
      open: open.reduce((a, d) => a + Number(d.gross || 0), 0),
      openCount: open.length,
    };
  }, [list]);

  const title = mode === 'offer' ? 'Angebote' : 'Rechnungen';

  return (
    <div className="min-h-screen bg-background">
      <BillingNav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {mode === 'offer' ? <FileText className="w-6 h-6" /> : <Receipt className="w-6 h-6" />} {title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {list.length} {title} · offen {eur(sum.open)} ({sum.openCount}) · gesamt {eur(sum.total)}
            </p>
          </div>
          <Button onClick={() => navigate(`/beleg/neu?kind=${mode === 'offer' ? 'offer' : 'invoice'}`)} className="gap-2">
            <Plus className="w-4 h-4" /> Neues {mode === 'offer' ? 'Angebot' : 'Rechnung'}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input className="pl-9" placeholder="Nummer, Kunde, Titel …" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {([['offen', 'Offen'], ['overdue', 'Überfällig'], ['alle', 'Alle']] as const).map(([v, label]) => (
            <Button key={v} size="sm" variant={view === v ? 'secondary' : 'outline'}
              onClick={() => { setView(v); setStatus('alle'); setSp(v === 'alle' ? {} : { f: v }); }}>
              {label}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-muted-foreground">Laden …</p>
        ) : list.length === 0 ? (
          <Card className="p-10 text-center text-muted-foreground">
            Noch keine {title}. Lege gleich {mode === 'offer' ? 'ein Angebot' : 'eine Rechnung'} an.
          </Card>
        ) : (
          <div className="space-y-2">
            {list.map((d) => (
              <Link key={d.id} to={`/beleg/${d.id}`}>
                <Card className="p-3 hover:border-primary transition-colors flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{d.number || 'ohne Nummer'}</span>
                      {d.kind !== 'invoice' && d.kind !== 'offer' && (
                        <Badge variant="outline" className="text-[10px]">{DOC_KIND_LABEL[d.kind]}</Badge>
                      )}
                      {d.legacy_source && <Badge variant="outline" className="text-[10px]">Archiv</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {d.recipient_company || d.recipient_name || '—'}{d.title ? ` · ${d.title}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold">{eur(Number(d.gross))}</div>
                    <div className="text-xs text-muted-foreground">
                      {isOverdue(d)
                        ? <span className="text-red-600 font-semibold">{daysLate(d.due_date)} Tage überfällig</span>
                        : d.due_date && !['paid', 'cancelled'].includes(d.status)
                          ? `fällig ${fmtDate(d.due_date)}`
                          : fmtDate(d.doc_date)}
                    </div>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-md shrink-0 ${STATUS_STYLE[d.status] || ''}`}>
                    {DOC_STATUS_LABEL[d.status] || d.status}
                  </span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
