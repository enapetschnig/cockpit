import { DmcContact, DmcStage, DMC_STAGE_LABELS } from '@/types/dmc';
import { DmcContactCard } from './DmcContactCard';

interface DmcPipelineColumnProps {
  stage: DmcStage;
  contacts: DmcContact[];
  onContactClick: (contact: DmcContact) => void;
}

const stageColors: Record<DmcStage, string> = {
  new: 'bg-blue-500',
  letter_sent: 'bg-amber-500',
  address_wrong: 'bg-orange-500',
  ready: 'bg-violet-500',
  contacted: 'bg-cyan-500',
  interested: 'bg-green-500',
  not_interested: 'bg-slate-500',
  won: 'bg-emerald-600',
  lost: 'bg-red-500',
};

const stageBgColors: Record<DmcStage, string> = {
  new: 'bg-blue-50 dark:bg-blue-950/30',
  letter_sent: 'bg-amber-50 dark:bg-amber-950/30',
  address_wrong: 'bg-orange-50 dark:bg-orange-950/30',
  ready: 'bg-violet-50 dark:bg-violet-950/30',
  contacted: 'bg-cyan-50 dark:bg-cyan-950/30',
  interested: 'bg-green-50 dark:bg-green-950/30',
  not_interested: 'bg-slate-100 dark:bg-slate-900/30',
  won: 'bg-emerald-50 dark:bg-emerald-950/30',
  lost: 'bg-red-50 dark:bg-red-950/30',
};

export function DmcPipelineColumn({ stage, contacts, onContactClick }: DmcPipelineColumnProps) {
  const stageContacts = contacts.filter((c) => c.stage === stage);
  
  return (
    <div className={`rounded-lg p-4 ${stageBgColors[stage]} min-w-[280px] flex-1`}>
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-3 h-3 rounded-full ${stageColors[stage]}`} />
        <h2 className="font-semibold text-foreground">{DMC_STAGE_LABELS[stage]}</h2>
        <span className="ml-auto bg-background rounded-full px-2.5 py-0.5 text-sm font-medium text-muted-foreground">
          {stageContacts.length}
        </span>
      </div>
      
      <div className="space-y-3 overflow-y-auto max-h-[calc(100vh-320px)] scrollbar-thin pr-1">
        {stageContacts.map((contact) => (
          <DmcContactCard 
            key={contact.id} 
            contact={contact} 
            onClick={() => onContactClick(contact)}
          />
        ))}
        {stageContacts.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Keine Kontakte
          </div>
        )}
      </div>
    </div>
  );
}
