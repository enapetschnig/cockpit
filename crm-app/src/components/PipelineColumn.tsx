import { Lead, LeadStage, STAGE_LABELS } from '@/types/lead';
import { LeadCard } from './LeadCard';

interface PipelineColumnProps {
  stage: LeadStage;
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
  onLeadUpdate?: (id: string, updates: Partial<Lead>) => void;
}

const stageColors: Record<LeadStage, string> = {
  new: 'bg-blue-500',
  contacted: 'bg-amber-500',
  follow_up: 'bg-orange-500',
  qualified: 'bg-green-500',
  unqualified: 'bg-slate-500',
  meeting_scheduled: 'bg-cyan-500',
  meeting_done: 'bg-teal-500',
  no_show: 'bg-pink-500',
  won: 'bg-emerald-600',
  lost: 'bg-red-500',
};

const stageBgColors: Record<LeadStage, string> = {
  new: 'bg-blue-50',
  contacted: 'bg-amber-50',
  follow_up: 'bg-orange-50',
  qualified: 'bg-green-50',
  unqualified: 'bg-slate-100',
  meeting_scheduled: 'bg-cyan-50',
  meeting_done: 'bg-teal-50',
  no_show: 'bg-pink-50',
  won: 'bg-emerald-50',
  lost: 'bg-red-50',
};

export function PipelineColumn({ stage, leads, onLeadClick, onLeadUpdate }: PipelineColumnProps) {
  const stageLeads = leads.filter((lead) => lead.stage === stage);

  return (
    <div className={`pipeline-stage ${stageBgColors[stage]} min-w-[300px] flex-1`}>
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-3 h-3 rounded-full ${stageColors[stage]}`} />
        <h2 className="font-semibold text-foreground">{STAGE_LABELS[stage]}</h2>
        <span className="ml-auto bg-background rounded-full px-2.5 py-0.5 text-sm font-medium text-muted-foreground">
          {stageLeads.length}
        </span>
      </div>

      <div className="space-y-3 overflow-y-auto max-h-[calc(100vh-280px)] scrollbar-thin pr-1">
        {stageLeads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onClick={() => onLeadClick(lead)}
            onUpdate={onLeadUpdate}
          />
        ))}
        {stageLeads.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Keine Leads
          </div>
        )}
      </div>
    </div>
  );
}
