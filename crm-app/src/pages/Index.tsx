import { useState } from 'react';
import { useLeads } from '@/hooks/useLeads';
import { Header } from '@/components/Header';
import { PipelineColumn } from '@/components/PipelineColumn';
import { AddLeadDialog } from '@/components/AddLeadDialog';
import { LeadDetailDialog } from '@/components/LeadDetailDialog';
import { CallbackList } from '@/components/CallbackList';
import { Lead, LeadStage } from '@/types/lead';
import { WeeklyActivityOverview } from '@/components/WeeklyActivityOverview';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

const ALL_STAGES: LeadStage[] = ['new', 'contacted', 'follow_up', 'qualified', 'unqualified', 'meeting_scheduled', 'meeting_done', 'no_show', 'won', 'lost'];

const Index = () => {
  const { leads, addLead, updateLead, deleteLead, addContactLog, deleteContactLog } = useLeads();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
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
        </div>

        <ScrollArea className="w-full whitespace-nowrap flex-1">
          <div className="flex gap-4 pb-4">
            {visibleStages.map((stage) => (
              <PipelineColumn
                key={stage}
                stage={stage}
                leads={leads}
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
