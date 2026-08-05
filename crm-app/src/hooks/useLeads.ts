import { useState, useEffect, useCallback } from 'react';
import { Lead, LeadStage, LeadSource, ContactLog } from '@/types/lead';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

const STORAGE_KEY = 'epower-crm-leads';
const MIGRATION_KEY = 'epower-crm-migrated';

export function useLeads() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch leads from database
  const fetchLeads = useCallback(async () => {
    if (!user) {
      setLeads([]);
      setIsLoading(false);
      return;
    }

    try {
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (leadsError) throw leadsError;

      // Fetch contact logs for all leads
      const { data: logsData, error: logsError } = await supabase
        .from('contact_logs')
        .select('*');

      if (logsError) throw logsError;

      // Map database rows to Lead type
      const mappedLeads: Lead[] = (leadsData || []).map((row) => ({
        id: row.id,
        fullName: row.full_name,
        phone: row.phone || '',
        email: row.email || undefined,
        companyName: row.company_name || undefined,
        source: row.source as LeadSource,
        stage: row.stage as LeadStage,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        isEntrepreneur: row.is_entrepreneur || undefined,
        hasMoreThan5Employees: row.has_more_than_5_employees || undefined,
        qualificationNotes: row.qualification_notes || undefined,
        meetingDate: row.meeting_date || undefined,
        meetingAppeared: row.meeting_appeared || undefined,
        saleAmount: row.sale_amount ? Number(row.sale_amount) : undefined,
        callbackDate: row.callback_date || undefined,
        callbackComment: row.callback_comment || undefined,
        callbackSetAt: (row as any).callback_set_at || undefined,
        customerWishes: row.customer_wishes || undefined,
        adName: row.ad_name || undefined,
        campaignName: row.campaign_name || undefined,
        platform: row.platform || undefined,
        offerId: (row as any).offer_id || null,
        contactLogs: (logsData || [])
          .filter((log) => log.lead_id === row.id)
          .map((log) => ({
            id: log.id,
            date: log.date,
            type: log.type as ContactLog['type'],
            comment: log.comment || '',
            reachedCustomer: log.reached_customer || false,
          })),
      }));

      setLeads(mappedLeads);
    } catch (error: any) {
      console.error('Error fetching leads:', error);
      toast.error('Fehler beim Laden der Leads');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Migrate localStorage data to database
  const migrateLocalData = useCallback(async () => {
    if (!user) return;

    const alreadyMigrated = localStorage.getItem(MIGRATION_KEY);
    if (alreadyMigrated) return;

    // Check if user already has leads in the database - if so, skip migration
    const { data: existingLeads, error: checkError } = await supabase
      .from('leads')
      .select('id')
      .limit(1);

    if (checkError) {
      console.error('Error checking existing leads:', checkError);
      return;
    }

    // User already has data in database, mark as migrated and skip
    if (existingLeads && existingLeads.length > 0) {
      localStorage.setItem(MIGRATION_KEY, 'true');
      localStorage.removeItem(STORAGE_KEY); // Clean up old data
      return;
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      localStorage.setItem(MIGRATION_KEY, 'true');
      return;
    }

    try {
      const localLeads: Lead[] = JSON.parse(stored);
      if (localLeads.length === 0) {
        localStorage.setItem(MIGRATION_KEY, 'true');
        return;
      }

      toast.info('Migriere lokale Daten zur Cloud...');

      for (const lead of localLeads) {
        // Insert lead
        const { data: insertedLead, error: leadError } = await supabase
          .from('leads')
          .insert({
            user_id: user.id,
            full_name: lead.fullName,
            phone: lead.phone || null,
            email: lead.email || null,
            company_name: lead.companyName || null,
            source: lead.source,
            stage: lead.stage,
            is_entrepreneur: lead.isEntrepreneur || false,
            has_more_than_5_employees: lead.hasMoreThan5Employees || false,
            qualification_notes: lead.qualificationNotes || null,
            meeting_date: lead.meetingDate || null,
            meeting_appeared: lead.meetingAppeared || null,
            sale_amount: lead.saleAmount || null,
            callback_date: lead.callbackDate || null,
            customer_wishes: lead.customerWishes || null,
            ad_name: lead.adName || null,
            campaign_name: lead.campaignName || null,
            platform: lead.platform || null,
            created_at: lead.createdAt,
            updated_at: lead.updatedAt,
          })
          .select()
          .single();

        if (leadError) {
          console.error('Error migrating lead:', leadError);
          continue;
        }

        // Insert contact logs
        if (lead.contactLogs && lead.contactLogs.length > 0) {
          const logs = lead.contactLogs.map((log) => ({
            lead_id: insertedLead.id,
            date: log.date,
            type: log.type,
            comment: log.comment,
            reached_customer: log.reachedCustomer,
          }));

          const { error: logsError } = await supabase
            .from('contact_logs')
            .insert(logs);

          if (logsError) {
            console.error('Error migrating contact logs:', logsError);
          }
        }
      }

      localStorage.setItem(MIGRATION_KEY, 'true');
      localStorage.removeItem(STORAGE_KEY); // Clean up old localStorage data
      toast.success(`${localLeads.length} Leads erfolgreich migriert!`);
      fetchLeads();
    } catch (error) {
      console.error('Migration error:', error);
      toast.error('Fehler bei der Migration');
    }
  }, [user, fetchLeads]);

  // Load leads when user changes
  useEffect(() => {
    if (user) {
      migrateLocalData().then(() => fetchLeads());
    } else {
      setLeads([]);
      setIsLoading(false);
    }
  }, [user, fetchLeads, migrateLocalData]);

  const addLead = async (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'contactLogs'>) => {
    if (!user) {
      toast.error('Du musst eingeloggt sein');
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('leads')
        .insert({
          user_id: user.id,
          full_name: lead.fullName,
          phone: lead.phone || null,
          email: lead.email || null,
          company_name: lead.companyName || null,
          source: lead.source,
          stage: lead.stage,
          is_entrepreneur: lead.isEntrepreneur || false,
          has_more_than_5_employees: lead.hasMoreThan5Employees || false,
        })
        .select()
        .single();

      if (error) throw error;

      const newLead: Lead = {
        id: data.id,
        fullName: data.full_name,
        phone: data.phone || '',
        email: data.email || undefined,
        companyName: data.company_name || undefined,
        source: data.source as LeadSource,
        stage: data.stage as LeadStage,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        isEntrepreneur: data.is_entrepreneur || undefined,
        hasMoreThan5Employees: data.has_more_than_5_employees || undefined,
        contactLogs: [],
      };

      setLeads((prev) => [newLead, ...prev]);
      toast.success('Lead hinzugefügt!');
      return newLead;
    } catch (error: any) {
      console.error('Error adding lead:', error);
      toast.error('Fehler beim Hinzufügen des Leads');
      return null;
    }
  };

  const updateLead = async (id: string, updates: Partial<Lead>) => {
    if (!user) return;

    try {
      const dbUpdates: Record<string, any> = {};
      
      if (updates.fullName !== undefined) dbUpdates.full_name = updates.fullName;
      if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
      if (updates.email !== undefined) dbUpdates.email = updates.email;
      if (updates.companyName !== undefined) dbUpdates.company_name = updates.companyName;
      if (updates.source !== undefined) dbUpdates.source = updates.source;
      if (updates.stage !== undefined) dbUpdates.stage = updates.stage;
      if (updates.isEntrepreneur !== undefined) dbUpdates.is_entrepreneur = updates.isEntrepreneur;
      if (updates.hasMoreThan5Employees !== undefined) dbUpdates.has_more_than_5_employees = updates.hasMoreThan5Employees;
      if (updates.qualificationNotes !== undefined) dbUpdates.qualification_notes = updates.qualificationNotes;
      if (updates.meetingDate !== undefined) dbUpdates.meeting_date = updates.meetingDate;
      if (updates.meetingAppeared !== undefined) dbUpdates.meeting_appeared = updates.meetingAppeared;
      if (updates.saleAmount !== undefined) dbUpdates.sale_amount = updates.saleAmount;
      if (updates.callbackDate !== undefined) {
        dbUpdates.callback_date = updates.callbackDate;
        dbUpdates.callback_set_at = updates.callbackDate ? new Date().toISOString() : null;
      }
      if (updates.callbackComment !== undefined) dbUpdates.callback_comment = updates.callbackComment;
      if (updates.customerWishes !== undefined) dbUpdates.customer_wishes = updates.customerWishes;
      if (updates.offerId !== undefined) (dbUpdates as any).offer_id = updates.offerId;

      const { error } = await supabase
        .from('leads')
        .update(dbUpdates)
        .eq('id', id);

      if (error) throw error;

      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === id
            ? { ...lead, ...updates, updatedAt: new Date().toISOString() }
            : lead
        )
      );
    } catch (error: any) {
      console.error('Error updating lead:', error);
      toast.error('Fehler beim Aktualisieren des Leads');
    }
  };

  const deleteLead = async (id: string) => {
    if (!user) return;

    try {
      const { error } = await supabase.from('leads').delete().eq('id', id);

      if (error) throw error;

      setLeads((prev) => prev.filter((lead) => lead.id !== id));
      toast.success('Lead gelöscht');
    } catch (error: any) {
      console.error('Error deleting lead:', error);
      toast.error('Fehler beim Löschen des Leads');
    }
  };

  const updateStage = async (id: string, stage: LeadStage) => {
    await updateLead(id, { stage });
  };

  const addContactLog = async (leadId: string, log: Omit<ContactLog, 'id'>) => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('contact_logs')
        .insert({
          lead_id: leadId,
          date: log.date,
          type: log.type,
          comment: log.comment,
          reached_customer: log.reachedCustomer,
        })
        .select()
        .single();

      if (error) throw error;

      const newLog: ContactLog = {
        id: data.id,
        date: data.date,
        type: data.type as ContactLog['type'],
        comment: data.comment || '',
        reachedCustomer: data.reached_customer || false,
      };

      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId
            ? {
                ...lead,
                contactLogs: [...lead.contactLogs, newLog],
                updatedAt: new Date().toISOString(),
              }
            : lead
        )
      );
      toast.success('Kontakt dokumentiert!');
    } catch (error: any) {
      console.error('Error adding contact log:', error);
      toast.error('Fehler beim Hinzufügen des Kontaktlogs');
    }
  };

  const deleteContactLog = async (leadId: string, logId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase.from('contact_logs').delete().eq('id', logId);
      if (error) throw error;
      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId
            ? { ...lead, contactLogs: lead.contactLogs.filter((l) => l.id !== logId) }
            : lead
        )
      );
      toast.success('Kontakt entfernt');
    } catch (error: any) {
      console.error('Error deleting contact log:', error);
      toast.error('Fehler beim Entfernen des Kontakts');
    }
  };

  const getLeadsByStage = (stage: LeadStage) => {
    return leads.filter((lead) => lead.stage === stage);
  };

  const getLeadsBySource = (source: LeadSource) => {
    return leads.filter((lead) => lead.source === source);
  };

  return {
    leads,
    isLoading,
    addLead,
    updateLead,
    deleteLead,
    updateStage,
    addContactLog,
    deleteContactLog,
    getLeadsByStage,
    getLeadsBySource,
  };
}
