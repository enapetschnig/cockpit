import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DmcContact, DmcContactUpdate, DmcStage, DMC_STAGES, DMC_STAGE_LABELS } from '@/types/dmc';
import { Building2, User, MapPin, Phone, Mail, Globe, Trash2, Calendar, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface DmcContactDetailDialogProps {
  contact: DmcContact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (id: string, updates: DmcContactUpdate) => Promise<any>;
  onDelete: (id: string) => Promise<boolean>;
}

interface LocalContactState {
  company_name: string;
  ceo_name: string;
  street: string;
  postal_code: string;
  city: string;
  phone: string;
  email: string;
  stage: DmcStage;
  contact_notes: string;
  letter_sent_date: string;
  first_contact_date: string;
}

function contactToLocal(contact: DmcContact): LocalContactState {
  return {
    company_name: contact.company_name || '',
    ceo_name: contact.ceo_name || '',
    street: contact.street || '',
    postal_code: contact.postal_code || '',
    city: contact.city || '',
    phone: contact.phone || '',
    email: contact.email || '',
    stage: contact.stage,
    contact_notes: contact.contact_notes || '',
    letter_sent_date: contact.letter_sent_date ? new Date(contact.letter_sent_date).toISOString().split('T')[0] : '',
    first_contact_date: contact.first_contact_date ? new Date(contact.first_contact_date).toISOString().split('T')[0] : '',
  };
}

export function DmcContactDetailDialog({
  contact,
  open,
  onOpenChange,
  onUpdate,
  onDelete,
}: DmcContactDetailDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [local, setLocal] = useState<LocalContactState>({
    company_name: '', ceo_name: '', street: '', postal_code: '', city: '',
    phone: '', email: '', stage: 'new' as DmcStage, contact_notes: '',
    letter_sent_date: '', first_contact_date: '',
  });
  const { toast } = useToast();

  useEffect(() => {
    if (contact && open) {
      setLocal(contactToLocal(contact));
    }
  }, [contact, open]);

  const hasChanges = useMemo(() => {
    if (!contact) return false;
    const original = contactToLocal(contact);
    return Object.keys(original).some(
      (key) => original[key as keyof LocalContactState] !== local[key as keyof LocalContactState]
    );
  }, [contact, local]);

  if (!contact) return null;

  const updateField = (field: keyof LocalContactState, value: string) => {
    setLocal(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    const updates: DmcContactUpdate = {
      company_name: local.company_name,
      ceo_name: local.ceo_name || null,
      street: local.street || null,
      postal_code: local.postal_code || null,
      city: local.city || null,
      phone: local.phone || null,
      email: local.email || null,
      stage: local.stage,
      contact_notes: local.contact_notes || null,
      letter_sent_date: local.letter_sent_date ? new Date(local.letter_sent_date).toISOString() : null,
      first_contact_date: local.first_contact_date ? new Date(local.first_contact_date).toISOString() : null,
    };
    const result = await onUpdate(contact.id, updates);
    setIsSaving(false);
    if (result) {
      toast({ title: 'Gespeichert', description: 'Kontakt wurde aktualisiert.' });
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    const success = await onDelete(contact.id);
    setIsDeleting(false);
    if (success) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            {local.company_name || contact.company_name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Stage Selection */}
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={local.stage} onValueChange={(value) => updateField('stage', value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DMC_STAGES.map((stage) => (
                  <SelectItem key={stage} value={stage}>{DMC_STAGE_LABELS[stage]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Company & Contact Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Building2 className="w-4 h-4" />Firma</Label>
              <Input value={local.company_name} onChange={(e) => updateField('company_name', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><User className="w-4 h-4" />Geschäftsführer</Label>
              <Input value={local.ceo_name} onChange={(e) => updateField('ceo_name', e.target.value)} placeholder="Name des Geschäftsführers" />
            </div>
          </div>

          {/* Address */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2"><MapPin className="w-4 h-4" />Adresse</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input value={local.street} onChange={(e) => updateField('street', e.target.value)} placeholder="Straße" className="col-span-3" />
              <Input value={local.postal_code} onChange={(e) => updateField('postal_code', e.target.value)} placeholder="PLZ" />
              <Input value={local.city} onChange={(e) => updateField('city', e.target.value)} placeholder="Ort" className="col-span-2" />
            </div>
          </div>

          {/* Contact Details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Phone className="w-4 h-4" />Telefon</Label>
              <Input value={local.phone} onChange={(e) => updateField('phone', e.target.value)} placeholder="Telefonnummer" />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Mail className="w-4 h-4" />E-Mail</Label>
              <Input value={local.email} onChange={(e) => updateField('email', e.target.value)} placeholder="E-Mail Adresse" type="email" />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Calendar className="w-4 h-4" />Brief verschickt am</Label>
              <Input type="date" value={local.letter_sent_date} onChange={(e) => updateField('letter_sent_date', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Calendar className="w-4 h-4" />Erstmals kontaktiert am</Label>
              <Input type="date" value={local.first_contact_date} onChange={(e) => updateField('first_contact_date', e.target.value)} />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notizen</Label>
            <Textarea value={local.contact_notes} onChange={(e) => updateField('contact_notes', e.target.value)} placeholder="Notizen zum Kontakt..." rows={4} />
          </div>

          {/* Source URL */}
          {contact.source_url && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Globe className="w-4 h-4" />Quelle</Label>
              <a href={contact.source_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">{contact.source_url}</a>
            </div>
          )}

          {/* Save & Delete */}
          <div className="pt-4 border-t border-border flex items-center justify-between">
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting} className="gap-2">
              <Trash2 className="w-4 h-4" />Kontakt löschen
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges || isSaving} className="gap-2">
              <Save className="w-4 h-4" />{isSaving ? 'Speichern...' : 'Speichern'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
