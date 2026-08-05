import { useMemo, useState } from 'react';
import { BillingNav } from '@/components/billing/BillingNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useArchive } from '@/hooks/useBilling';
import { fmtDate } from '@/types/billing';
import { FileDown, Search, Archive } from 'lucide-react';

const KIND_LABEL: Record<string, string> = { invoice: 'Rechnungen', offer: 'Angebote', kassabuch: 'Kassabuch', sonstiges: 'Sonstiges' };

export default function ArchivPage() {
  const { files, isLoading, openFile } = useArchive();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('alle');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return files.filter((f) => (kind === 'alle' || f.kind === kind) && (!s || f.file_name.toLowerCase().includes(s)));
  }, [files, q, kind]);

  return (
    <div className="min-h-screen bg-background">
      <BillingNav />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold flex items-center gap-2 mb-1"><Archive className="w-6 h-6" /> Beleg-Archiv</h1>
        <p className="text-sm text-muted-foreground mb-4">{files.length} Dateien aus dem alten Buchhaltungsprogramm · jederzeit abrufbar</p>
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input className="pl-9" placeholder="Dateiname suchen …" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {['alle', 'invoice', 'offer', 'kassabuch', 'sonstiges'].map((k) => (
            <Button key={k} size="sm" variant={kind === k ? 'secondary' : 'outline'} onClick={() => setKind(k)}>
              {k === 'alle' ? 'Alle' : KIND_LABEL[k]}
            </Button>
          ))}
        </div>
        {isLoading ? <p className="text-muted-foreground">Laden …</p> : (
          <div className="space-y-1.5">
            {list.map((f) => (
              <Card key={f.id} className="p-3 flex items-center gap-3">
                <FileDown className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{f.file_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {f.doc_date ? fmtDate(f.doc_date) : f.period || ''} · {f.size_bytes ? Math.round(f.size_bytes / 1024) + ' KB' : ''}
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">{KIND_LABEL[f.kind] || f.kind}</Badge>
                <Button size="sm" variant="outline" onClick={() => openFile(f)}>Öffnen</Button>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
