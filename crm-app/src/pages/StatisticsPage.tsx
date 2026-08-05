import { useState } from 'react';
import { useLeads } from '@/hooks/useLeads';
import { Header } from '@/components/Header';
import { Statistics } from '@/pages/Statistics';
import { AddLeadDialog } from '@/components/AddLeadDialog';

const StatisticsPage = () => {
  const { leads, addLead } = useLeads();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const wonLeads = leads.filter((l) => l.stage === 'won');
  const totalRevenue = wonLeads.reduce((sum, l) => sum + (l.saleAmount || 0), 0);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        onAddLead={() => setIsAddDialogOpen(true)}
        leadCount={leads.length}
        wonCount={wonLeads.length}
        totalRevenue={totalRevenue}
      />

      <div className="flex-1 p-6 overflow-auto">
        <Statistics leads={leads} />
      </div>

      <AddLeadDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        onAdd={addLead}
      />
    </div>
  );
};

export default StatisticsPage;
