import { useEffect, useMemo, useState } from 'react';
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
import { Lead, LeadStage, ContactLog, STAGE_LABELS, SOURCE_LABELS } from '@/types/lead';
import { Switch } from '@/components/ui/switch';
import { useNavigate } from 'react-router-dom';
import { FileText, Receipt } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Phone, Mail, Building2, MessageSquare, Trash2, Euro, CheckCircle2, XCircle, Clock, Save, Pencil, X, CalendarClock, Mic } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { useOffers } from '@/hooks/useOffers';
import { OfferPicker } from '@/components/OfferPicker';

interface LeadDetailDialogProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (id: string, updates: Partial<Lead>) => void;
  onAddContactLog: (leadId: string, log: Omit<ContactLog, 'id'>) => void;
  onDeleteContactLog?: (leadId: string, logId: string) => void;
  onDelete: (id: string) => void;
}

const PIPELINE_STAGES: LeadStage[] = ['new', 'contacted', 'follow_up', 'qualified', 'unqualified', 'meeting_scheduled', 'meeting_done', 'no_show', 'won', 'lost'];

const stageButtonColors: Record<LeadStage, string> = {
  new: 'bg-blue-500 hover:bg-blue-600 text-white',
  contacted: 'bg-amber-500 hover:bg-amber-600 text-white',
  follow_up: 'bg-orange-500 hover:bg-orange-600 text-white',
  qualified: 'bg-green-500 hover:bg-green-600 text-white',
  unqualified: 'bg-slate-500 hover:bg-slate-600 text-white',
  meeting_scheduled: 'bg-cyan-500 hover:bg-cyan-600 text-white',
  meeting_done: 'bg-teal-500 hover:bg-teal-600 text-white',
  no_show: 'bg-pink-500 hover:bg-pink-600 text-white',
  won: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  lost: 'bg-red-500 hover:bg-red-600 text-white',
};

export function LeadDetailDialog({
  lead,
  open,
  onOpenChange,
  onUpdate,
  onAddContactLog,
  onDeleteContactLog,
  onDelete,
}: LeadDetailDialogProps) {
  const navigate = useNavigate();
  const { offers } = useOffers();
  const [newComment, setNewComment] = useState('');
  const [reachedCustomer, setReachedCustomer] = useState(true);
  const [contactType, setContactType] = useState<ContactLog['type']>('call');
  const [contactDateTime, setContactDateTime] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  // Pipeline: Draft-State (manuelles Speichern)
  const [draftStage, setDraftStage] = useState<LeadStage>('new');
  const [draftMeetingDate, setDraftMeetingDate] = useState<string>('');
  const [draftMeetingAppeared, setDraftMeetingAppeared] = useState(false);
  const [draftSaleAmount, setDraftSaleAmount] = useState<string>('');
  const [draftQualificationNotes, setDraftQualificationNotes] = useState('');
  const [draftCallbackDate, setDraftCallbackDate] = useState<string>('');
  const [draftCallbackComment, setDraftCallbackComment] = useState<string>('');

  // Kontakt-Bearbeitung Draft-State
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [draftFullName, setDraftFullName] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftCompanyName, setDraftCompanyName] = useState('');
  const [draftIsEntrepreneur, setDraftIsEntrepreneur] = useState(false);
  const [draftHasMoreThan5Employees, setDraftHasMoreThan5Employees] = useState(false);

  useEffect(() => {
    if (!lead) return;
    setDraftStage(lead.stage);
    setDraftMeetingDate(lead.meetingDate ? format(new Date(lead.meetingDate), "yyyy-MM-dd'T'HH:mm") : '');
    setDraftMeetingAppeared(lead.meetingAppeared || false);
    setDraftSaleAmount(lead.saleAmount != null ? String(lead.saleAmount) : '');
    setDraftQualificationNotes(lead.qualificationNotes || '');
    setDraftCallbackDate(lead.callbackDate ? format(new Date(lead.callbackDate), "yyyy-MM-dd") : '');
    setDraftCallbackComment(lead.callbackComment || '');
    // Kontaktdaten
    setDraftFullName(lead.fullName);
    setDraftPhone(lead.phone);
    setDraftEmail(lead.email || '');
    setDraftCompanyName(lead.companyName || '');
    setDraftIsEntrepreneur(lead.isEntrepreneur || false);
    setDraftHasMoreThan5Employees(lead.hasMoreThan5Employees || false);
    setIsEditingContact(false);
  }, [lead?.id, open]);

  const isMeetingFieldsVisible = useMemo(() => {
    return draftStage === 'meeting_scheduled' || draftStage === 'meeting_done' || draftStage === 'won' || draftStage === 'lost';
  }, [draftStage]);

  if (!lead) return null;

  const handleAddContact = () => {
    if (!newComment.trim()) return;
    onAddContactLog(lead.id, {
      date: new Date(contactDateTime).toISOString(),
      type: contactType,
      comment: newComment,
      reachedCustomer,
    });
    setNewComment('');
    setContactDateTime(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  };

  const handleSavePipeline = () => {
    const updates: Partial<Lead> = {
      stage: draftStage,
      qualificationNotes: draftQualificationNotes.trim() ? draftQualificationNotes : undefined,
    };

    if (isMeetingFieldsVisible) {
      updates.meetingDate = draftMeetingDate ? new Date(draftMeetingDate).toISOString() : undefined;
      updates.meetingAppeared = draftMeetingAppeared;
    } else {
      updates.meetingDate = undefined;
      updates.meetingAppeared = undefined;
    }

    if (draftStage === 'won') {
      const n = Number(draftSaleAmount);
      updates.saleAmount = Number.isFinite(n) && n >= 0 ? n : undefined;
    } else {
      updates.saleAmount = undefined;
    }

    onUpdate(lead.id, updates);
  };

  const getStageColor = (stage: LeadStage) => {
    switch (stage) {
      case 'new':
        return 'stage-new';
      case 'contacted':
        return 'stage-contact';
      case 'follow_up':
        return 'bg-orange-100 text-orange-700';
      case 'qualified':
        return 'stage-won';
      case 'unqualified':
        return 'bg-slate-100 text-slate-700';
      case 'meeting_scheduled':
      case 'meeting_done':
        return 'stage-meeting';
      case 'no_show':
        return 'bg-pink-100 text-pink-700';
      case 'won':
        return 'stage-won';
      case 'lost':
        return 'stage-lost';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 flex-wrap">
            <span>{lead.fullName}</span>
            <span className={`stage-badge ${getStageColor(lead.stage)}`}>
              {STAGE_LABELS[lead.stage]}
            </span>
            <OfferPicker
              offers={offers}
              selectedOfferId={lead.offerId}
              onChange={(offerId) => onUpdate(lead.id, { offerId })}
              size="md"
              stopPropagation={false}
            />
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 mt-3">
          <Button size="sm" variant="outline" className="gap-1.5"
            onClick={() => navigate(`/beleg/neu?kind=offer&lead=${lead.id}`)}>
            <FileText className="w-4 h-4" /> Angebot erstellen
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5"
            onClick={() => navigate(`/beleg/neu?kind=invoice&lead=${lead.id}`)}>
            <Receipt className="w-4 h-4" /> Rechnung erstellen
          </Button>
        </div>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Übersicht</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="history">Kontakte</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <ScrollArea className="h-[400px] pr-4">
              {!isEditingContact ? (
                <>
                  <div className="flex justify-end mb-2">
                    <Button variant="outline" size="sm" onClick={() => setIsEditingContact(true)}>
                      <Pencil className="w-4 h-4 mr-2" />
                      Bearbeiten
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-xs">Telefon</Label>
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-muted-foreground" />
                        <a href={`tel:${lead.phone}`} className="text-primary hover:underline">
                          {lead.phone}
                        </a>
                      </div>
                    </div>

                    {lead.email && (
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-xs">E-Mail</Label>
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-muted-foreground" />
                          <a href={`mailto:${lead.email}`} className="text-primary hover:underline">
                            {lead.email}
                          </a>
                        </div>
                      </div>
                    )}

                    {lead.companyName && lead.companyName !== 'ja' && (
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-xs">Firma</Label>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                          <span>{lead.companyName}</span>
                        </div>
                      </div>
                    )}

                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-xs">Leadquelle</Label>
                      <span className="block">{SOURCE_LABELS[lead.source]}</span>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-xs">Lead erhalten</Label>
                      <span className="block">
                        {format(new Date(lead.createdAt), 'dd.MM.yyyy HH:mm', { locale: de })} Uhr
                      </span>
                    </div>

                    {lead.adName && (
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-xs">Anzeige</Label>
                        <span className="block text-sm">{lead.adName}</span>
                      </div>
                    )}

                    {lead.saleAmount && (
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-xs">Verkaufssumme</Label>
                        <div className="flex items-center gap-2 text-success font-semibold">
                          <Euro className="w-4 h-4" />
                          <span>{lead.saleAmount.toLocaleString('de-DE')} €</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t mt-4">
                    <h4 className="font-medium mb-3">Qualifikation</h4>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        {lead.isEntrepreneur ? (
                          <CheckCircle2 className="w-4 h-4 text-success" />
                        ) : (
                          <XCircle className="w-4 h-4 text-muted-foreground" />
                        )}
                        <span>Unternehmer / Selbstständig</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {lead.hasMoreThan5Employees ? (
                          <CheckCircle2 className="w-4 h-4 text-success" />
                        ) : (
                          <XCircle className="w-4 h-4 text-muted-foreground" />
                        )}
                        <span>Mehr als 5 Mitarbeiter</span>
                      </div>
                    </div>
                  </div>

                  {lead.qualificationNotes && (
                    <div className="pt-4 border-t mt-4">
                      <Label className="text-muted-foreground text-xs">Notizen</Label>
                      <p className="mt-1">{lead.qualificationNotes}</p>
                    </div>
                  )}

                  <div className="pt-4 border-t mt-4">
                    <Label className="text-muted-foreground text-xs flex items-center gap-1 mb-2">
                      <Mic className="w-3.5 h-3.5" /> Kundenwunsch
                    </Label>
                    <VoiceRecorder
                      initialText={lead.customerWishes || ''}
                      onSave={(text) => onUpdate(lead.id, { customerWishes: text })}
                    />
                  </div>

                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="font-medium">Kontakt bearbeiten</h4>
                    <Button variant="ghost" size="sm" onClick={() => setIsEditingContact(false)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="editFullName">Name</Label>
                      <Input
                        id="editFullName"
                        value={draftFullName}
                        onChange={(e) => setDraftFullName(e.target.value)}
                        placeholder="Vor- und Nachname"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="editPhone">Telefon</Label>
                      <Input
                        id="editPhone"
                        value={draftPhone}
                        onChange={(e) => setDraftPhone(e.target.value)}
                        placeholder="+43..."
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="editEmail">E-Mail</Label>
                      <Input
                        id="editEmail"
                        type="email"
                        value={draftEmail}
                        onChange={(e) => setDraftEmail(e.target.value)}
                        placeholder="email@beispiel.at"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="editCompany">Firma</Label>
                      <Input
                        id="editCompany"
                        value={draftCompanyName}
                        onChange={(e) => setDraftCompanyName(e.target.value)}
                        placeholder="Firmenname"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <Label htmlFor="editEntrepreneur">Unternehmer / Selbstständig</Label>
                      <Switch
                        id="editEntrepreneur"
                        checked={draftIsEntrepreneur}
                        onCheckedChange={setDraftIsEntrepreneur}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <Label htmlFor="editEmployees">Mehr als 5 Mitarbeiter</Label>
                      <Switch
                        id="editEmployees"
                        checked={draftHasMoreThan5Employees}
                        onCheckedChange={setDraftHasMoreThan5Employees}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button variant="outline" onClick={() => setIsEditingContact(false)}>
                      Abbrechen
                    </Button>
                    <Button onClick={() => {
                      onUpdate(lead.id, {
                        fullName: draftFullName.trim(),
                        phone: draftPhone.trim(),
                        email: draftEmail.trim() || undefined,
                        companyName: draftCompanyName.trim() || undefined,
                        isEntrepreneur: draftIsEntrepreneur,
                        hasMoreThan5Employees: draftHasMoreThan5Employees,
                      });
                      setIsEditingContact(false);
                    }}>
                      <Save className="w-4 h-4 mr-2" />
                      Speichern
                    </Button>
                  </div>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="pipeline" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                <div className="space-y-3">
                  <Label>Status ändern</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {PIPELINE_STAGES.map((stage) => (
                      <Button
                        key={stage}
                        type="button"
                        variant={draftStage === stage ? 'default' : 'outline'}
                        className={`justify-start ${draftStage === stage ? stageButtonColors[stage] : ''}`}
                        onClick={() => setDraftStage(stage)}
                      >
                        <div className={`w-2.5 h-2.5 rounded-full mr-2 ${
                          stage === 'new' ? 'bg-blue-500' :
                          stage === 'contacted' ? 'bg-amber-500' :
                          stage === 'follow_up' ? 'bg-orange-500' :
                          stage === 'qualified' ? 'bg-green-500' :
                          stage === 'unqualified' ? 'bg-slate-500' :
                          stage === 'meeting_scheduled' ? 'bg-cyan-500' :
                          stage === 'meeting_done' ? 'bg-teal-500' :
                          stage === 'won' ? 'bg-emerald-600' : 'bg-red-500'
                        }`} />
                        {STAGE_LABELS[stage]}
                      </Button>
                    ))}
                  </div>
                </div>

                {isMeetingFieldsVisible && (
                  <div className="space-y-4 pt-4 border-t">
                    <div className="space-y-2">
                      <Label htmlFor="meetingDate">Terminsdatum</Label>
                      <Input
                        id="meetingDate"
                        type="datetime-local"
                        value={draftMeetingDate}
                        onChange={(e) => setDraftMeetingDate(e.target.value)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <Label htmlFor="meetingAppeared">Zum Termin erschienen</Label>
                      <Switch
                        id="meetingAppeared"
                        checked={draftMeetingAppeared}
                        onCheckedChange={setDraftMeetingAppeared}
                      />
                    </div>
                  </div>
                )}

                {draftStage === 'won' && (
                  <div className="space-y-2 pt-4 border-t">
                    <Label htmlFor="saleAmount">Verkaufssumme (€)</Label>
                    <Input
                      id="saleAmount"
                      type="number"
                      value={draftSaleAmount}
                      onChange={(e) => setDraftSaleAmount(e.target.value)}
                      placeholder="z.B. 45000"
                    />
                  </div>
                )}

                <div className="space-y-2 pt-4 border-t">
                  <Label htmlFor="qualificationNotes">Qualifikationsnotizen</Label>
                  <Textarea
                    id="qualificationNotes"
                    className="min-h-[80px] resize-none"
                    value={draftQualificationNotes}
                    onChange={(e) => setDraftQualificationNotes(e.target.value)}
                    placeholder="Was hat der Lead gesagt? Passt er zur Zielgruppe?"
                    rows={3}
                  />
                </div>

                <div className="flex justify-end pt-2 pb-2">
                  <Button type="button" onClick={handleSavePipeline}>
                    <Save className="w-4 h-4 mr-2" />
                    Speichern
                  </Button>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                {/* Kontakthistorie - oben, sofort sichtbar */}
                <div className="space-y-3">
                  {lead.contactLogs.slice().reverse().map((log) => (
                    <div key={log.id} className="p-3 bg-card border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`stage-badge ${log.type === 'call' ? 'stage-new' : log.type === 'email' ? 'stage-contact' : log.type === 'meeting' ? 'stage-qualified' : 'stage-meeting'}`}>
                            {log.type === 'call' ? 'Anruf' : log.type === 'email' ? 'E-Mail' : log.type === 'meeting' ? 'Meeting' : 'Notiz'}
                          </span>
                          {log.reachedCustomer ? (
                            <span className="text-xs text-success flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Erreicht
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <XCircle className="w-3 h-3" /> Nicht erreicht
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-medium">
                            {format(new Date(log.date), 'dd.MM.yyyy HH:mm', { locale: de })} Uhr
                          </span>
                          {onDeleteContactLog && (
                            <button
                              onClick={() => {
                                if (confirm('Diesen Kontakteintrag wirklich löschen?')) {
                                  onDeleteContactLog(lead.id, log.id);
                                }
                              }}
                              className="p-1 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                              title="Kontakteintrag entfernen"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm">{log.comment}</p>
                    </div>
                  ))}
                  {lead.contactLogs.length === 0 && (
                    <p className="text-center text-muted-foreground py-8">
                      Noch keine Kontakte dokumentiert
                    </p>
                  )}
                </div>

                {/* Neuen Kontakt dokumentieren */}
                <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                  <div className="flex gap-3 flex-wrap">
                    <Select value={contactType} onValueChange={(v: ContactLog['type']) => setContactType(v)}>
                      <SelectTrigger className="w-[130px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="call">Anruf</SelectItem>
                        <SelectItem value="email">E-Mail</SelectItem>
                        <SelectItem value="meeting">Meeting</SelectItem>
                        <SelectItem value="note">Notiz</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="reached"
                        checked={reachedCustomer}
                        onCheckedChange={setReachedCustomer}
                      />
                      <Label htmlFor="reached" className="text-sm">Erreicht</Label>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contactDateTime" className="text-sm flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Datum & Uhrzeit
                    </Label>
                    <Input
                      id="contactDateTime"
                      type="datetime-local"
                      value={contactDateTime}
                      onChange={(e) => setContactDateTime(e.target.value)}
                    />
                  </div>
                  <Textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Was hat der Lead gesagt? Kommentar zum Gespräch..."
                    rows={3}
                  />
                  <Button onClick={handleAddContact} disabled={!newComment.trim()}>
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Kontakt dokumentieren
                  </Button>
                </div>

                {/* Rückruf-Datum Bereich */}
                <div className="p-4 bg-muted/30 rounded-lg border space-y-3">
                  <Label htmlFor="callbackDate" className="flex items-center gap-2">
                    <CalendarClock className="w-4 h-4" />
                    Wann wieder anrufen?
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="callbackDate"
                      type="date"
                      value={draftCallbackDate}
                      onChange={(e) => setDraftCallbackDate(e.target.value)}
                      className="w-[180px]"
                    />
                    {draftCallbackDate && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-muted-foreground"
                        onClick={() => {
                          setDraftCallbackDate('');
                          setDraftCallbackComment('');
                        }}
                      >
                        <X className="w-3 h-3 mr-1" />
                        Entfernen
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="callbackComment" className="text-sm text-muted-foreground">
                      Kommentar zum Rückruf
                    </Label>
                    <Textarea
                      id="callbackComment"
                      value={draftCallbackComment}
                      onChange={(e) => setDraftCallbackComment(e.target.value)}
                      placeholder="z.B. Angebot besprechen, Fragen klären..."
                      rows={2}
                      className="resize-none"
                    />
                  </div>
                  <Button 
                    size="sm" 
                    onClick={() => {
                      onUpdate(lead.id, {
                        callbackDate: draftCallbackDate ? new Date(draftCallbackDate).toISOString() : undefined,
                        callbackComment: draftCallbackComment.trim() || undefined,
                      });
                    }}
                  >
                    <Save className="w-3 h-3 mr-1" />
                    Speichern
                  </Button>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between pt-4 border-t mt-4">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onDelete(lead.id);
              onOpenChange(false);
            }}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Lead löschen
          </Button>
          <Button onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
