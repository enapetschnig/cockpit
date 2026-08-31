import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BillingNav } from '@/components/billing/BillingNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCustomers } from '@/hooks/useBilling';
import { customerLabel, type Customer } from '@/types/billing';
import { APPS } from '@/lib/apps';
import { Search, Plus, FileText, Receipt, Mail, Phone } from 'lucide-react';

export default function KundenPage() {
  const { customers, isLoading, save } = useCustomers();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  const navigate = useNavigate();

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? customers.filter((c) =>
      [c.company_name, c.first_name, c.last_name, c.city, c.email, c.customer_no]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s))) : customers;
    return base.slice(0, 300);
  }, [customers, q]);

  return (
    <div className="min-h-screen bg-background">
      <BillingNav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold">Kunden</h1>
            <p className="text-sm text-muted-foreground">{customers.length} Kunden · zeigt {list.length}</p>
          </div>
          <Button className="gap-2" onClick={() => setEdit({})}><Plus className="w-4 h-4" /> Neuer Kunde</Button>
        </div>
        <div className="relative mb-4">
          <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
          <Input className="pl-9" placeholder="Firma, Name, Ort, E-Mail …" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {isLoading ? <p className="text-muted-foreground">Laden …</p> : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {list.map((c) => (
              <Card key={c.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <button className="text-left flex-1 min-w-0" onClick={() => setEdit(c)}>
                    <div className="font-semibold truncate">{customerLabel(c)}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[c.postal_code, c.city].filter(Boolean).join(' ')}
                    </div>
                    <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
                      {c.email && <span className="flex items-center gap-1 truncate"><Mail className="w-3 h-3" />{c.email}</span>}
                      {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>}
                    </div>
                  </button>
                  {c.source === 'hellocash' && <Badge variant="outline" className="text-[9px] shrink-0">Import</Badge>}
                </div>
                <div className="flex gap-1 mt-2">
                  <Button size="sm" variant="outline" className="gap-1 flex-1 text-xs"
                    onClick={() => navigate(`/beleg/neu?kind=offer&customer=${c.id}`)}>
                    <FileText className="w-3 h-3" /> Angebot
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1 flex-1 text-xs"
                    onClick={() => navigate(`/beleg/neu?kind=invoice&customer=${c.id}`)}>
                    <Receipt className="w-3 h-3" /> Rechnung
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{edit?.id ? 'Kunde bearbeiten' : 'Neuer Kunde'}</DialogTitle></DialogHeader>
          {edit && (
            <div className="grid sm:grid-cols-2 gap-2">
              <Input placeholder="Firma" value={edit.company_name || ''} onChange={(e) => setEdit({ ...edit, company_name: e.target.value })} className="sm:col-span-2" />
              <Input placeholder="Vorname" value={edit.first_name || ''} onChange={(e) => setEdit({ ...edit, first_name: e.target.value })} />
              <Input placeholder="Nachname" value={edit.last_name || ''} onChange={(e) => setEdit({ ...edit, last_name: e.target.value })} />
              <Input placeholder="E-Mail" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
              <Input placeholder="Telefon" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
              <Input placeholder="Straße" value={edit.street || ''} onChange={(e) => setEdit({ ...edit, street: e.target.value })} />
              <Input placeholder="Nr." value={edit.house_no || ''} onChange={(e) => setEdit({ ...edit, house_no: e.target.value })} />
              <Input placeholder="PLZ" value={edit.postal_code || ''} onChange={(e) => setEdit({ ...edit, postal_code: e.target.value })} />
              <Input placeholder="Ort" value={edit.city || ''} onChange={(e) => setEdit({ ...edit, city: e.target.value })} />
              <Input placeholder="UID (ATU…)" value={edit.uid_number || ''} onChange={(e) => setEdit({ ...edit, uid_number: e.target.value })} className="sm:col-span-2" />
              {/* Legt fest, wessen App-Meldungen unter „Wünsche" diesem Kunden zugeordnet werden. */}
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Handwerker-App</label>
                <select
                  value={edit.app_key || ''}
                  onChange={(e) => setEdit({ ...edit, app_key: e.target.value || null })}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">— keine App zugeordnet —</option>
                  {APPS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Meldungen aus dieser App erscheinen unter „Wünsche" bei diesem Kunden.
                </p>
              </div>
              <Button className="sm:col-span-2" onClick={async () => { await save(edit); setEdit(null); }}>Speichern</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
