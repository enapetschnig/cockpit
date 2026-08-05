import { useEffect, useState } from 'react';
import { BillingNav } from '@/components/billing/BillingNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useCompanySettings } from '@/hooks/useBilling';
import type { CompanySettings } from '@/types/billing';
import { Save } from 'lucide-react';

export default function FirmaPage() {
  const { settings, isLoading, save } = useCompanySettings();
  const [f, setF] = useState<Partial<CompanySettings>>({});
  useEffect(() => { if (settings) setF(settings); }, [settings]);
  const F = (k: keyof CompanySettings, label: string, type = 'text', ph = '') => (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type={type} placeholder={ph} value={(f[k] as string | number) ?? ''} onChange={(e) => setF({ ...f, [k]: type === 'number' ? Number(e.target.value) : e.target.value })} />
    </div>
  );
  if (isLoading) return <div className="min-h-screen bg-background"><BillingNav /><p className="p-8 text-muted-foreground">Laden …</p></div>;
  return (
    <div className="min-h-screen bg-background">
      <BillingNav />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-2xl font-bold">Firmendaten & Belege</h1>
        <p className="text-sm text-muted-foreground -mt-3">Diese Angaben erscheinen auf Angeboten und Rechnungen (Pflichtangaben lt. § 11 UStG).</p>

        <Card className="p-4 grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">{F('company_name', 'Firmenname')}</div>
          {F('street', 'Straße')}
          <div className="flex gap-2">
            <div className="w-24">{F('postal_code', 'PLZ')}</div>
            <div className="flex-1">{F('city', 'Ort')}</div>
          </div>
          {F('phone', 'Telefon')}
          {F('email', 'E-Mail')}
          {F('website', 'Website')}
          {F('uid_number', 'UID-Nummer', 'text', 'ATU…')}
          {F('firmenbuch', 'Firmenbuchnummer', 'text', 'FN …')}
          {F('gericht', 'Firmenbuchgericht')}
        </Card>

        <Card className="p-4 grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3 font-semibold text-sm">Bankverbindung</div>
          {F('bank_name', 'Bank')}
          {F('iban', 'IBAN')}
          {F('bic', 'BIC')}
        </Card>

        <Card className="p-4 grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3 font-semibold text-sm">Belege</div>
          {F('offer_prefix', 'Präfix Angebot')}
          {F('invoice_prefix', 'Präfix Rechnung')}
          {F('default_vat', 'Standard-USt %', 'number')}
          {F('default_payment_days', 'Zahlungsziel (Tage)', 'number')}
          {F('offer_valid_days', 'Angebot gültig (Tage)', 'number')}
          <div className="flex items-end gap-2">
            <input id="kl" type="checkbox" checked={!!f.small_business} onChange={(e) => setF({ ...f, small_business: e.target.checked })} className="w-4 h-4" />
            <Label htmlFor="kl" className="text-xs">Kleinunternehmer (§ 6 UStG)</Label>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="font-semibold text-sm">Standardtexte</div>
          <div><Label className="text-xs text-muted-foreground">Angebot – Einleitung</Label>
            <Textarea rows={2} value={f.offer_intro || ''} onChange={(e) => setF({ ...f, offer_intro: e.target.value })} /></div>
          <div><Label className="text-xs text-muted-foreground">Angebot – Schluss</Label>
            <Textarea rows={2} value={f.offer_outro || ''} onChange={(e) => setF({ ...f, offer_outro: e.target.value })} /></div>
          <div><Label className="text-xs text-muted-foreground">Rechnung – Einleitung</Label>
            <Textarea rows={2} value={f.invoice_intro || ''} onChange={(e) => setF({ ...f, invoice_intro: e.target.value })} /></div>
          <div><Label className="text-xs text-muted-foreground">Rechnung – Schluss</Label>
            <Textarea rows={2} value={f.invoice_outro || ''} onChange={(e) => setF({ ...f, invoice_outro: e.target.value })} /></div>
        </Card>

        <Button className="gap-2" onClick={() => save(f)}><Save className="w-4 h-4" /> Speichern</Button>
      </main>
    </div>
  );
}
