import { useState } from 'react';
import { Header } from '@/components/Header';
import { useOffers } from '@/hooks/useOffers';
import { useLeads } from '@/hooks/useLeads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, Save, Tag } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const PRESET_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#64748b',
];

const OffersPage = () => {
  const { offers, addOffer, updateOffer, deleteOffer } = useOffers();
  const { leads } = useLeads();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);

  const wonLeads = leads.filter((l) => l.stage === 'won');
  const totalRevenue = wonLeads.reduce((sum, l) => sum + (l.saleAmount || 0), 0);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await addOffer(newName.trim(), newColor);
    setNewName('');
  };

  const usageCount = (offerId: string) =>
    leads.filter((l) => l.offerId === offerId).length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header onAddLead={() => {}} leadCount={leads.length} wonCount={wonLeads.length} totalRevenue={totalRevenue} />

      <main className="flex-1 p-6 max-w-3xl w-full mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Tag className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Etiketten</h1>
        </div>

        <Card className="p-4 mb-6">
          <h2 className="font-semibold mb-3">Neues Etikett anlegen</h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="offerName" className="text-xs text-muted-foreground">Name</Label>
              <Input
                id="offerName"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="z. B. Zeiterfassung, Premium-Paket"
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Farbe</Label>
              <div className="flex gap-1.5 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${newColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    aria-label={`Farbe ${c}`}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-end">
              <Button onClick={handleAdd} disabled={!newName.trim()}>
                <Plus className="w-4 h-4 mr-1" /> Hinzufügen
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-2">
          {offers.length === 0 && (
            <p className="text-center text-muted-foreground py-8">Noch keine Etiketten angelegt</p>
          )}
          {offers.map((offer) => (
            <OfferRow
              key={offer.id}
              offer={offer}
              usage={usageCount(offer.id)}
              onUpdate={updateOffer}
              onDelete={deleteOffer}
            />
          ))}
        </div>
      </main>
    </div>
  );
};

interface OfferRowProps {
  offer: { id: string; name: string; color: string };
  usage: number;
  onUpdate: (id: string, updates: { name?: string; color?: string }) => void;
  onDelete: (id: string) => void;
}

function OfferRow({ offer, usage, onUpdate, onDelete }: OfferRowProps) {
  const [name, setName] = useState(offer.name);
  const [color, setColor] = useState(offer.color);
  const dirty = name !== offer.name || color !== offer.color;

  return (
    <Card className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-center gap-2 flex-1">
        <span
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium text-white"
          style={{ backgroundColor: color }}
        >
          <Tag className="w-3.5 h-3.5" />
          {name || 'Ohne Name'}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-1">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        <div className="flex gap-1">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-foreground' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">{usage} Lead{usage === 1 ? '' : 's'}</span>
        <Button
          size="sm"
          disabled={!dirty || !name.trim()}
          onClick={() => onUpdate(offer.id, { name: name.trim(), color })}
        >
          <Save className="w-3.5 h-3.5" />
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (confirm(`Etikett "${offer.name}" wirklich löschen? Es wird bei ${usage} Lead(s) entfernt.`)) {
                    onDelete(offer.id);
                  }
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Löschen</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </Card>
  );
}

export default OffersPage;
