import { useState } from 'react';
import { Lead } from '@/types/lead';
import { Phone, Building2, ChevronRight, Calendar, X } from 'lucide-react';
import { format, isToday, isPast, isTomorrow, parseISO, startOfDay, addDays, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { useOffers } from '@/hooks/useOffers';

// Prüft, ob ein Lead seit dem Setzen des Callbacks kontaktiert wurde
const wasContactedSinceCallback = (lead: Lead): boolean => {
  if (!lead.contactLogs || lead.contactLogs.length === 0 || !lead.callbackDate) return false;
  // Referenzzeitpunkt: wann wurde der Callback gesetzt (fallback: callbackDate selbst)
  const reference = lead.callbackSetAt
    ? parseISO(lead.callbackSetAt)
    : parseISO(lead.callbackDate);
  return lead.contactLogs.some((log) => parseISO(log.date) > reference);
};

interface CallbackListProps {
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
  onRemoveCallback?: (lead: Lead) => void;
}

export function CallbackList({ leads, onLeadClick, onRemoveCallback }: CallbackListProps) {
  const today = startOfDay(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const { offers } = useOffers();
  
  // Datumsoptionen: Heute, Morgen, Übermorgen, In 3 Tagen
  const dateOptions = [
    { date: today, label: 'Heute' },
    { date: addDays(today, 1), label: 'Morgen' },
    { date: addDays(today, 2), label: format(addDays(today, 2), 'EEE dd.MM.', { locale: de }) },
    { date: addDays(today, 3), label: format(addDays(today, 3), 'EEE dd.MM.', { locale: de }) },
  ];
  
  // Alle Leads mit Callback-Datum filtern (nicht gewonnen/verloren, nicht seit Callback kontaktiert)
  const allCallbackLeads = leads.filter((lead) => {
    if (!lead.callbackDate) return false;
    if (lead.stage === 'won' || lead.stage === 'lost') return false;
    // Wenn seit Callback-Datum kontaktiert, aus der Liste entfernen
    if (wasContactedSinceCallback(lead)) return false;
    return true;
  });

  // Überfällige Leads (vor heute)
  const overdueLeads = allCallbackLeads.filter((lead) => {
    const callbackDay = startOfDay(parseISO(lead.callbackDate!));
    return callbackDay < today;
  });

  // Leads für ausgewähltes Datum
  const callbackLeads = allCallbackLeads
    .filter((lead) => {
      const callbackDay = startOfDay(parseISO(lead.callbackDate!));
      // Bei "Heute" auch überfällige anzeigen
      if (isSameDay(selectedDate, today)) {
        return callbackDay <= today;
      }
      return isSameDay(callbackDay, selectedDate);
    })
    .sort((a, b) => {
      const dateA = parseISO(a.callbackDate!);
      const dateB = parseISO(b.callbackDate!);
      return dateA.getTime() - dateB.getTime();
    });

  // Zähle Leads pro Tag
  const getCountForDate = (date: Date) => {
    if (isSameDay(date, today)) {
      // Heute + überfällige
      return allCallbackLeads.filter((lead) => {
        const callbackDay = startOfDay(parseISO(lead.callbackDate!));
        return callbackDay <= today;
      }).length;
    }
    return allCallbackLeads.filter((lead) => {
      const callbackDay = startOfDay(parseISO(lead.callbackDate!));
      return isSameDay(callbackDay, date);
    }).length;
  };

  // Wenn keine Callback-Leads existieren, nicht anzeigen
  if (allCallbackLeads.length === 0) {
    return null;
  }

  const getDateLabel = (dateStr: string) => {
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Heute';
    if (isTomorrow(date)) return 'Morgen';
    if (isPast(date)) return 'Überfällig';
    return format(date, 'dd.MM.', { locale: de });
  };

  const getDateColor = (dateStr: string) => {
    const date = startOfDay(parseISO(dateStr));
    if (date < today) return 'text-red-600 bg-red-50';
    if (isToday(parseISO(dateStr))) return 'text-orange-600 bg-orange-50';
    return 'text-muted-foreground bg-muted';
  };

  return (
    <div className="bg-card border rounded-lg shadow-sm">
      <div className="p-4 border-b">
        <div className="flex items-center gap-2 mb-3">
          <Phone className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Anrufen</h2>
          {overdueLeads.length > 0 && isSameDay(selectedDate, today) && (
            <span className="bg-red-100 text-red-600 rounded-full px-2 py-0.5 text-xs font-medium">
              {overdueLeads.length} überfällig
            </span>
          )}
        </div>
        
        {/* Datumsfilter */}
        <div className="flex gap-2 flex-wrap">
          {dateOptions.map((option) => {
            const count = getCountForDate(option.date);
            const isSelected = isSameDay(selectedDate, option.date);
            return (
              <Button
                key={option.date.toISOString()}
                variant={isSelected ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => setSelectedDate(option.date)}
              >
                <Calendar className="w-3.5 h-3.5" />
                {option.label}
                {count > 0 && (
                  <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${
                    isSelected 
                      ? 'bg-primary-foreground/20 text-primary-foreground' 
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {count}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      </div>

      {callbackLeads.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground">
          Keine Anrufe für {isSameDay(selectedDate, today) ? 'heute' : format(selectedDate, 'EEEE, dd. MMMM', { locale: de })} geplant
        </div>
      ) : (
        <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
          <div className="divide-y">
            {callbackLeads.map((lead) => {
              const offer = lead.offerId ? offers.find((o) => o.id === lead.offerId) : null;
              return (
              <button
                key={lead.id}
                onClick={() => onLeadClick(lead)}
                className="w-full p-3 text-left hover:bg-muted/50 transition-colors flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate flex items-center gap-2">
                    <span className="truncate">{lead.fullName}</span>
                    {offer && (
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full text-white shrink-0"
                        style={{ backgroundColor: offer.color }}
                      >
                        {offer.name}
                      </span>
                    )}
                  </div>
                  {lead.companyName && lead.companyName !== 'ja' && (
                    <div className="text-sm text-muted-foreground flex items-center gap-1 truncate">
                      <Building2 className="w-3 h-3" />
                      {lead.companyName}
                    </div>
                  )}
                  {lead.callbackComment && (
                    <div className="text-xs text-muted-foreground mt-1 truncate italic">
                      „{lead.callbackComment}"
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2 py-1 rounded ${getDateColor(lead.callbackDate!)}`}>
                    {getDateLabel(lead.callbackDate!)}
                  </span>
                  <a
                    href={`tel:${lead.phone}`}
                    onClick={(e) => e.stopPropagation()}
                    className="p-2 rounded-full bg-green-100 text-green-600 hover:bg-green-200 transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                  </a>
                  {onRemoveCallback && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveCallback(lead);
                      }}
                      className="p-2 rounded-full bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      title="Aus Anrufliste entfernen"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
