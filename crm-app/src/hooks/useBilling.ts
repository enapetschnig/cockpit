import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';
import type {
  Article, BillingDocument, CashBookEntry, CompanySettings, Customer, DocKind, DocumentItem, ArchiveFile,
} from '@/types/billing';
import { computeTotals, lineNet } from '@/types/billing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/* ── Kunden ─────────────────────────────────────────────── */
export function useCustomers() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setCustomers([]); setLoading(false); return; }
    const { data, error } = await db.from('customers').select('*').order('company_name', { ascending: true }).limit(2000);
    if (error) toast.error('Kunden konnten nicht geladen werden');
    setCustomers((data as Customer[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const save = async (c: Partial<Customer>) => {
    if (!user) return null;
    if (c.id) {
      const { data, error } = await db.from('customers').update(c).eq('id', c.id).select().single();
      if (error) { toast.error('Speichern fehlgeschlagen'); return null; }
      await load(); return data as Customer;
    }
    const { data, error } = await db.from('customers').insert({ ...c, user_id: user.id }).select().single();
    if (error) { toast.error('Anlegen fehlgeschlagen'); return null; }
    await load(); return data as Customer;
  };

  const remove = async (id: string) => {
    const { error } = await db.from('customers').delete().eq('id', id);
    if (error) return toast.error('Löschen fehlgeschlagen');
    await load();
  };

  return { customers, isLoading, reload: load, save, remove };
}

/* ── Artikel / Vorlagen ─────────────────────────────────── */
export function useArticles() {
  const { user } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setArticles([]); setLoading(false); return; }
    const { data } = await db.from('articles').select('*').eq('active', true)
      .order('is_favorite', { ascending: false }).order('use_count', { ascending: false }).order('name');
    setArticles((data as Article[]) || []);
    setLoading(false);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const save = async (a: Partial<Article>) => {
    if (!user) return null;
    if (a.id) {
      const { data } = await db.from('articles').update(a).eq('id', a.id).select().single();
      await load(); return data as Article;
    }
    const { data } = await db.from('articles').insert({ ...a, user_id: user.id }).select().single();
    await load(); return data as Article;
  };
  const remove = async (id: string) => { await db.from('articles').update({ active: false }).eq('id', id); await load(); };
  const bump = async (id: string, count: number) => { await db.from('articles').update({ use_count: count + 1 }).eq('id', id); };

  return { articles, isLoading, reload: load, save, remove, bump };
}

/* ── Firmendaten ────────────────────────────────────────── */
export function useCompanySettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setSettings(null); setLoading(false); return; }
    const { data } = await db.from('company_settings').select('*').maybeSingle();
    if (!data) {
      const { data: created } = await db.from('company_settings')
        .insert({ user_id: user.id, company_name: 'ePower GmbH' }).select().single();
      setSettings(created as CompanySettings);
    } else setSettings(data as CompanySettings);
    setLoading(false);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const save = async (s: Partial<CompanySettings>) => {
    if (!settings) return;
    const { error } = await db.from('company_settings').update(s).eq('id', settings.id);
    if (error) return toast.error('Speichern fehlgeschlagen');
    toast.success('Gespeichert');
    await load();
  };
  return { settings, isLoading, save, reload: load };
}

/* ── Belege (Angebote + Rechnungen) ─────────────────────── */
export function useDocuments(kinds?: DocKind[]) {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<BillingDocument[]>([]);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setDocuments([]); setLoading(false); return; }
    let qb = db.from('documents').select('*').order('doc_date', { ascending: false }).limit(1000);
    if (kinds?.length) qb = qb.in('kind', kinds);
    const { data, error } = await qb;
    if (error) toast.error('Belege konnten nicht geladen werden');
    setDocuments((data as BillingDocument[]) || []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, kinds?.join(',')]);
  useEffect(() => { load(); }, [load]);

  return { documents, isLoading, reload: load };
}

/** Nächste Belegnummer im Format AN-2026-0001 / RE-2026-0001 (fortlaufend, lückenlos). */
export async function nextNumber(kind: DocKind, settings: CompanySettings | null): Promise<string> {
  const year = new Date().getFullYear();
  const isOffer = kind === 'offer';
  const prefix = isOffer ? (settings?.offer_prefix || 'AN') : (settings?.invoice_prefix || 'RE');
  const kinds = isOffer ? ['offer'] : ['invoice', 'partial_invoice', 'final_invoice', 'credit_note'];
  const { data } = await db.from('documents').select('number')
    .in('kind', kinds).like('number', `${prefix}-${year}-%`).order('number', { ascending: false }).limit(1);
  const last = data?.[0]?.number as string | undefined;
  const n = last ? (parseInt(last.split('-').pop() || '0', 10) || 0) + 1 : 1;
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

/* ── Einzelner Beleg inkl. Positionen ───────────────────── */
export function useDocument(id?: string) {
  const { user } = useAuth();
  const [doc, setDoc] = useState<BillingDocument | null>(null);
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user || !id) { setDoc(null); setItems([]); setLoading(false); return; }
    const { data: d } = await db.from('documents').select('*').eq('id', id).maybeSingle();
    const { data: its } = await db.from('document_items').select('*').eq('document_id', id).order('position');
    setDoc((d as BillingDocument) || null);
    setItems((its as DocumentItem[]) || []);
    setLoading(false);
  }, [user, id]);
  useEffect(() => { load(); }, [load]);

  return { doc, items, isLoading, reload: load, setItems };
}

/** Beleg + Positionen speichern (Summen serverseitig konsistent berechnet). */
export async function saveDocument(
  doc: Partial<BillingDocument>,
  items: Partial<DocumentItem>[],
  userId: string,
): Promise<string | null> {
  const clean = items.map((it, i) => ({
    position: i,
    article_id: it.article_id ?? null,
    name: it.name || '',
    description: it.description ?? null,
    quantity: Number(it.quantity) || 0,
    unit: it.unit || 'Stk',
    unit_price: Number(it.unit_price) || 0,
    vat_rate: Number(it.vat_rate) || 0,
    discount_percent: Number(it.discount_percent) || 0,
    is_heading: !!it.is_heading,
    line_net: lineNet({
      quantity: Number(it.quantity) || 0,
      unit_price: Number(it.unit_price) || 0,
      discount_percent: Number(it.discount_percent) || 0,
      is_heading: !!it.is_heading,
    }),
  }));
  const t = computeTotals(
    clean.map((c) => ({ ...c })),
    Number(doc.discount_percent) || 0,
    { net: Number(doc.deducted_net) || 0, vat: Number(doc.deducted_vat) || 0 },
  );
  const payload = { ...doc, user_id: userId, net: t.net, vat: t.vat, gross: t.gross };
  delete (payload as Record<string, unknown>).items;

  let docId = doc.id;
  if (docId) {
    const { error } = await db.from('documents').update(payload).eq('id', docId);
    if (error) { toast.error('Speichern fehlgeschlagen: ' + error.message); return null; }
  } else {
    const { data, error } = await db.from('documents').insert(payload).select('id').single();
    if (error) { toast.error('Anlegen fehlgeschlagen: ' + error.message); return null; }
    docId = data.id as string;
  }
  await db.from('document_items').delete().eq('document_id', docId);
  if (clean.length) {
    const { error } = await db.from('document_items').insert(clean.map((c) => ({ ...c, document_id: docId })));
    if (error) { toast.error('Positionen: ' + error.message); return docId!; }
  }
  return docId!;
}

/* ── Kassabuch ──────────────────────────────────────────── */
export function useCashBook() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<CashBookEntry[]>([]);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setEntries([]); setLoading(false); return; }
    const { data } = await db.from('cash_book').select('*').order('entry_date', { ascending: false }).limit(1000);
    setEntries((data as CashBookEntry[]) || []);
    setLoading(false);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const add = async (e: Partial<CashBookEntry>) => {
    if (!user) return;
    const { error } = await db.from('cash_book').insert({ ...e, user_id: user.id });
    if (error) return toast.error('Speichern fehlgeschlagen');
    toast.success('Eintrag gespeichert');
    await load();
  };
  const remove = async (id: string) => { await db.from('cash_book').delete().eq('id', id); await load(); };

  return { entries, isLoading, add, remove, reload: load };
}

/* ── Archiv (alte PDFs) ─────────────────────────────────── */
export function useArchive() {
  const { user } = useAuth();
  const [files, setFiles] = useState<ArchiveFile[]>([]);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setFiles([]); setLoading(false); return; }
    const { data } = await db.from('archive_files').select('*').order('doc_date', { ascending: false }).limit(500);
    setFiles((data as ArchiveFile[]) || []);
    setLoading(false);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const openFile = async (f: ArchiveFile) => {
    const { data, error } = await supabase.storage.from('belege').createSignedUrl(f.storage_path, 300);
    if (error || !data) return toast.error('Datei konnte nicht geöffnet werden');
    window.open(data.signedUrl, '_blank');
  };

  return { files, isLoading, reload: load, openFile };
}
