import { DmcContact, DMC_STAGES } from '@/types/dmc';
import { DmcPipelineColumn } from './DmcPipelineColumn';

interface DmcPipelineViewProps {
  contacts: DmcContact[];
  onContactClick: (contact: DmcContact) => void;
}

export function DmcPipelineView({ contacts, onContactClick }: DmcPipelineViewProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {DMC_STAGES.map((stage) => (
        <DmcPipelineColumn
          key={stage}
          stage={stage}
          contacts={contacts}
          onContactClick={onContactClick}
        />
      ))}
    </div>
  );
}
