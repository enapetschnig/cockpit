import { useState } from 'react';
import { Lead } from '@/types/lead';
import { LeadCard } from './LeadCard';
import type { LeadPhase } from '@/hooks/useLeadPhasen';

interface PipelineColumnProps {
  phase: LeadPhase;
  phasen: LeadPhase[];
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
  onLeadUpdate?: (id: string, updates: Partial<Lead>) => void;
  onPhasenBearbeiten?: () => void;
}

export function PipelineColumn({ phase, phasen, leads, onLeadClick, onLeadUpdate, onPhasenBearbeiten }: PipelineColumnProps) {
  const stageLeads = leads.filter((lead) => lead.stage === phase.schluessel);
  // Karte hierher ziehen = Lead in diese Spalte
  const [drueber, setDrueber] = useState(false);

  return (
    <div
      className="pipeline-stage min-w-[300px] flex-1"
      style={{ backgroundColor: `${phase.farbe}${drueber ? '2e' : '14'}`, outline: drueber ? `2px dashed ${phase.farbe}` : undefined }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/lead-id')) { e.preventDefault(); setDrueber(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrueber(false); }}
      onDrop={(e) => {
        setDrueber(false);
        const id = e.dataTransfer.getData('text/lead-id');
        if (id && leads.find((l) => l.id === id)?.stage !== phase.schluessel) onLeadUpdate?.(id, { stage: phase.schluessel });
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: phase.farbe }} />
        <h2 className="font-semibold text-foreground">{phase.name}</h2>
        <span className="ml-auto bg-background rounded-full px-2.5 py-0.5 text-sm font-medium text-muted-foreground">
          {stageLeads.length}
        </span>
      </div>

      <div className="space-y-3 overflow-y-auto max-h-[calc(100vh-280px)] scrollbar-thin pr-1">
        {stageLeads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            phasen={phasen}
            onClick={() => onLeadClick(lead)}
            onUpdate={onLeadUpdate}
            onPhasenBearbeiten={onPhasenBearbeiten}
          />
        ))}
        {stageLeads.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {drueber ? 'Hier ablegen' : 'Keine Leads'}
          </div>
        )}
      </div>
    </div>
  );
}
