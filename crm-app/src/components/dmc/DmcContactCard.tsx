import { DmcContact, DMC_STAGE_LABELS } from '@/types/dmc';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, User, Phone, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface DmcContactCardProps {
  contact: DmcContact;
  onClick: () => void;
}

export function DmcContactCard({ contact, onClick }: DmcContactCardProps) {
  return (
    <Card 
      className="cursor-pointer hover:shadow-md transition-shadow bg-card"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <Building2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <span className="font-medium text-foreground text-sm leading-tight">
              {contact.company_name}
            </span>
          </div>
          
          {contact.ceo_name && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <User className="w-3.5 h-3.5 shrink-0" />
              <span>{contact.ceo_name}</span>
            </div>
          )}
          
          {contact.city && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span>{contact.postal_code} {contact.city}</span>
            </div>
          )}
          
          {contact.phone && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Phone className="w-3.5 h-3.5 shrink-0" />
              <span>{contact.phone}</span>
            </div>
          )}

          {contact.letter_sent_date && (
            <Badge variant="secondary" className="text-xs">
              Brief: {new Date(contact.letter_sent_date).toLocaleDateString('de-DE')}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
