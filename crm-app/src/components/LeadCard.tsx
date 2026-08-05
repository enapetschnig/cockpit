import { Lead, SOURCE_LABELS } from '@/types/lead';
import { Phone, Building2, Calendar, MessageSquare, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useOffers } from '@/hooks/useOffers';
import { OfferPicker } from '@/components/OfferPicker';

interface LeadCardProps {
  lead: Lead;
  onClick: () => void;
  onUpdate?: (id: string, updates: Partial<Lead>) => void;
}

export function LeadCard({ lead, onClick, onUpdate }: LeadCardProps) {
  const lastContact = lead.contactLogs[lead.contactLogs.length - 1];
  const { offers } = useOffers();

  return (
    <div className="lead-card" onClick={onClick}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-foreground">{lead.fullName}</h3>
          {lead.companyName && lead.companyName !== 'ja' && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
              <Building2 className="w-3.5 h-3.5" />
              <span className="truncate max-w-[180px]">{lead.companyName}</span>
            </div>
          )}
        </div>
        <span className={`stage-badge ${lead.source === 'facebook' ? 'stage-new' : 'stage-qualified'}`}>
          {SOURCE_LABELS[lead.source]}
        </span>
      </div>

      <div className="mb-3">
        <OfferPicker
          offers={offers}
          selectedOfferId={lead.offerId}
          onChange={(offerId) => onUpdate?.(lead.id, { offerId })}
        />
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Phone className="w-3.5 h-3.5" />
          <span>{lead.phone}</span>
        </div>

        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          <span>Lead: {format(new Date(lead.createdAt), 'dd.MM.yy HH:mm', { locale: de })}</span>
        </div>

        {lead.meetingDate && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="w-3.5 h-3.5" />
            <span>Termin: {format(new Date(lead.meetingDate), 'dd.MM.yy HH:mm', { locale: de })}</span>
          </div>
        )}

        {lastContact && (
          <div className="flex flex-col gap-1 pt-2 border-t border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MessageSquare className="w-3 h-3" />
              <span>Letzter Kontakt: {format(new Date(lastContact.date), 'dd.MM.yy HH:mm', { locale: de })}</span>
            </div>
            <p className="text-muted-foreground line-clamp-2 pl-5">{lastContact.comment}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
        <span>{lead.contactLogs.length} Kontakte</span>
        {lead.hasMoreThan5Employees && (
          <span className="text-success">{'>'} 5 MA</span>
        )}
      </div>
    </div>
  );
}

