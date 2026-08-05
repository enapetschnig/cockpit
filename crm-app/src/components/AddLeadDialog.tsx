import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Lead, LeadSource, SOURCE_LABELS } from '@/types/lead';
import { Switch } from '@/components/ui/switch';

interface AddLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'contactLogs'>) => void;
}

export function AddLeadDialog({ open, onOpenChange, onAdd }: AddLeadDialogProps) {
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    email: '',
    companyName: '',
    source: 'facebook' as LeadSource,
    isEntrepreneur: false,
    hasMoreThan5Employees: false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd({
      ...formData,
      stage: 'new',
    });
    setFormData({
      fullName: '',
      phone: '',
      email: '',
      companyName: '',
      source: 'facebook',
      isEntrepreneur: false,
      hasMoreThan5Employees: false,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Neuer Lead</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Name *</Label>
            <Input
              id="fullName"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              placeholder="Max Mustermann"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Telefon *</Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+49 176 12345678"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">E-Mail</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="max@firma.de"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="companyName">Firma</Label>
            <Input
              id="companyName"
              value={formData.companyName}
              onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
              placeholder="Mustermann GmbH"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="source">Leadquelle *</Label>
            <Select
              value={formData.source}
              onValueChange={(value: LeadSource) => setFormData({ ...formData, source: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Quelle wählen" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SOURCE_LABELS) as LeadSource[]).map((source) => (
                  <SelectItem key={source} value={source}>
                    {SOURCE_LABELS[source]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between py-2">
            <Label htmlFor="isEntrepreneur">Unternehmer/Selbstständig</Label>
            <Switch
              id="isEntrepreneur"
              checked={formData.isEntrepreneur}
              onCheckedChange={(checked) => setFormData({ ...formData, isEntrepreneur: checked })}
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <Label htmlFor="hasMoreThan5Employees">Mehr als 5 Mitarbeiter</Label>
            <Switch
              id="hasMoreThan5Employees"
              checked={formData.hasMoreThan5Employees}
              onCheckedChange={(checked) => setFormData({ ...formData, hasMoreThan5Employees: checked })}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit">
              Lead hinzufügen
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
