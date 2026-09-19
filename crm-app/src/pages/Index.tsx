import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLeads } from '@/hooks/useLeads';
import { Header } from '@/components/Header';
import { OffeneAuftraege } from '@/components/OffeneAuftraege';
import { VertragMeldung } from '@/components/VertragMeldung';
import { PipelineColumn } from '@/components/PipelineColumn';
import { AddLeadDialog } from '@/components/AddLeadDialog';
import { LeadDetailDialog } from '@/components/LeadDetailDialog';
import { CallbackList } from '@/components/CallbackList';
import { OpenInvoicesStrip } from '@/components/billing/OpenInvoicesStrip';
import { Lead, LeadSource, LeadStage, SOURCE_LABELS, SOURCE_STYLE } from '@/types/lead';
import { WeeklyActivityOverview } from '@/components/WeeklyActivityOverview';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

const ALL_STAGES: LeadStage[] = ['new', 'contacted', 'follow_up', 'qualified', 'unqualified', 'meeting_scheduled', 'meeting_done', 'no_show', 'won', 'lost'];

const Index = () => {
  const { leads, addLead, updateLead, deleteLead, addContactLog, deleteContactLog } = useLeads();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  // Quellen-Filter: nur Quellen anbieten, die es in den Leads auch gibt.
  const [sourceFilter, setSourceFilter] = useState<LeadSource | 'alle'>('alle');
  const vorhandeneQuellen = (Object.keys(SOURCE_LABELS) as LeadSource[]).filter((q) => leads.some((l) => l.source === q));
  const gefilterteLeads = sourceFilter === 'alle' ? leads : leads.filter((l) => l.source === sourceFilter);
  // Link aus dem Telegram-Ping (?lead=…): den Lead direkt aufmachen, sobald er geladen ist.
  const [sp, setSp] = useSearchParams();
  useEffect(() => {
    const id = sp.get('lead');
    if (id && leads.some((l) => l.id === id)) { setSelectedLeadId(id); setSp({}, { replace: true }); }
  }, [sp, leads, setSp]);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [showUnqualified, setShowUnqualified] = useState(false);

  const visibleStages = showUnqualified
    ? ALL_STAGES
    : ALL_STAGES.filter((s) => s !== 'unqualified');

  const unqualifiedCount = leads.filter((l) => l.stage === 'unqualified').length;

  const selectedLead = selectedLeadId
    ? leads.find((l) => l.id === selectedLeadId) || null
    : null;

  const wonLeads = leads.filter((l) => l.stage === 'won');
  const totalRevenue = wonLeads.reduce((sum, l) => sum + (l.saleAmount || 0), 0);

  const handleLeadClick = (lead: Lead) => {
    setSelectedLeadId(lead.id);
    setIsDetailDialogOpen(true);
  };

  // Check if there are leads to call today
  const hasCallbackLeads = leads.some((l) => l.callbackDate && l.stage !== 'won' && l.stage !== 'lost');

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        onAddLead={() => setIsAddDialogOpen(true)}
        leadCount={leads.length}
        wonCount={wonLeads.length}
        totalRevenue={totalRevenue}
      />

      <div className="flex-1 p-6 overflow-hidden flex flex-col gap-4">
        <VertragMeldung />
        <OpenInvoicesStrip />
        <OffeneAuftraege kompakt />
        <WeeklyActivityOverview leads={leads} />
        {hasCallbackLeads && (
          <CallbackList 
            leads={leads} 
            onLeadClick={handleLeadClick} 
            onRemoveCallback={(lead) => updateLead(lead.id, { callbackDate: null, callbackComment: null })}
          />
        )}

        <div className="flex items-center gap-2 mb-3">
          <Switch
            id="show-unqualified"
            checked={showUnqualified}
            onCheckedChange={setShowUnqualified}
          />
          <label htmlFor="show-unqualified" className="text-sm text-muted-foreground cursor-pointer select-none">
            Unqualifiziert anzeigen
          </label>
          {unqualifiedCount > 0 && (
            <Badge variant="secondary" className="text-xs">{unqualifiedCount}</Badge>
          )}
          {vorhandeneQuellen.length > 1 && (
            <div className="ml-auto flex items-center gap-1 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">Quelle:</span>
              <button type="button" onClick={() => setSourceFilter('alle')}
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${sourceFilter === 'alle' ? 'bg-foreground text-background border-foreground' : 'bg-card text-muted-foreground'}`}>
                alle
              </button>
              {vorhandeneQuellen.map((q) => (
                <button key={q} type="button" onClick={() => setSourceFilter(sourceFilter === q ? 'alle' : q)}
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${SOURCE_STYLE[q]} ${sourceFilter === q ? 'ring-2 ring-offset-1 ring-foreground/60' : 'opacity-80 hover:opacity-100'}`}>
                  {SOURCE_LABELS[q]} <span className="font-normal">{leads.filter((l) => l.source === q).length}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <ScrollArea className="w-full whitespace-nowrap flex-1">
          <div className="flex gap-4 pb-4">
            {visibleStages.map((stage) => (
              <PipelineColumn
                key={stage}
                stage={stage}
                leads={gefilterteLeads}
                onLeadClick={handleLeadClick}
                onLeadUpdate={updateLead}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      <AddLeadDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        onAdd={addLead}
      />

      <LeadDetailDialog
        lead={selectedLead}
        open={isDetailDialogOpen}
        onOpenChange={(open) => {
          setIsDetailDialogOpen(open);
          if (!open) setSelectedLeadId(null);
        }}
        onUpdate={updateLead}
        onAddContactLog={addContactLog}
        onDeleteContactLog={deleteContactLog}
        onDelete={deleteLead}
      />
    </div>
  );
};

export default Index;
