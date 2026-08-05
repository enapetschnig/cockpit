import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DmcContactInsert } from '@/types/dmc';
import { Building2, User, MapPin, Phone, Mail } from 'lucide-react';

interface DmcAddContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (contact: DmcContactInsert) => Promise<any>;
}

export function DmcAddContactDialog({
  open,
  onOpenChange,
  onAdd,
}: DmcAddContactDialogProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState<DmcContactInsert>({
    company_name: '',
    ceo_name: '',
    street: '',
    postal_code: '',
    city: '',
    region: '',
    phone: '',
    email: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_name.trim()) return;

    setIsAdding(true);
    const result = await onAdd(formData);
    setIsAdding(false);

    if (result) {
      setFormData({
        company_name: '',
        ceo_name: '',
        street: '',
        postal_code: '',
        city: '',
        region: '',
        phone: '',
        email: '',
      });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Neuen Kontakt hinzufügen</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Firma *
            </Label>
            <Input
              value={formData.company_name}
              onChange={(e) => setFormData(prev => ({ ...prev, company_name: e.target.value }))}
              placeholder="Firmenname"
              required
            />
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <User className="w-4 h-4" />
              Geschäftsführer
            </Label>
            <Input
              value={formData.ceo_name || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, ceo_name: e.target.value }))}
              placeholder="Name des Geschäftsführers"
            />
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Adresse
            </Label>
            <Input
              value={formData.street || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, street: e.target.value }))}
              placeholder="Straße"
            />
            <div className="grid grid-cols-3 gap-2">
              <Input
                value={formData.postal_code || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, postal_code: e.target.value }))}
                placeholder="PLZ"
              />
              <Input
                value={formData.city || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                placeholder="Ort"
                className="col-span-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Phone className="w-4 h-4" />
                Telefon
              </Label>
              <Input
                value={formData.phone || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="Telefonnummer"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                E-Mail
              </Label>
              <Input
                value={formData.email || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="E-Mail"
                type="email"
              />
            </div>
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={isAdding || !formData.company_name.trim()}>
              {isAdding ? 'Wird hinzugefügt...' : 'Hinzufügen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
