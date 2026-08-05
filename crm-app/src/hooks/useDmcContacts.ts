import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { DmcContact, DmcContactInsert, DmcContactUpdate, DmcStage } from '@/types/dmc';
import { useToast } from '@/hooks/use-toast';

export function useDmcContacts() {
  const [contacts, setContacts] = useState<DmcContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchContacts = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('dmc_contacts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Cast the data to proper types
      const typedData = (data || []).map(contact => ({
        ...contact,
        stage: contact.stage as DmcStage,
      }));
      
      setContacts(typedData);
    } catch (error) {
      console.error('Error fetching DMC contacts:', error);
      toast({
        title: 'Fehler',
        description: 'Kontakte konnten nicht geladen werden.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, [user]);

  const addContact = async (contact: DmcContactInsert) => {
    if (!user) return null;

    try {
      const { data, error } = await supabase
        .from('dmc_contacts')
        .insert({
          ...contact,
          user_id: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      const typedData = {
        ...data,
        stage: data.stage as DmcStage,
      };

      setContacts(prev => [typedData, ...prev]);
      toast({
        title: 'Kontakt hinzugefügt',
        description: `${contact.company_name} wurde hinzugefügt.`,
      });
      return typedData;
    } catch (error) {
      console.error('Error adding DMC contact:', error);
      toast({
        title: 'Fehler',
        description: 'Kontakt konnte nicht hinzugefügt werden.',
        variant: 'destructive',
      });
      return null;
    }
  };

  const updateContact = async (id: string, updates: DmcContactUpdate) => {
    try {
      const { data, error } = await supabase
        .from('dmc_contacts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      const typedData = {
        ...data,
        stage: data.stage as DmcStage,
      };

      setContacts(prev =>
        prev.map(contact => (contact.id === id ? typedData : contact))
      );
      return typedData;
    } catch (error) {
      console.error('Error updating DMC contact:', error);
      toast({
        title: 'Fehler',
        description: 'Kontakt konnte nicht aktualisiert werden.',
        variant: 'destructive',
      });
      return null;
    }
  };

  const deleteContact = async (id: string) => {
    try {
      const { error } = await supabase
        .from('dmc_contacts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setContacts(prev => prev.filter(contact => contact.id !== id));
      toast({
        title: 'Kontakt gelöscht',
        description: 'Der Kontakt wurde entfernt.',
      });
      return true;
    } catch (error) {
      console.error('Error deleting DMC contact:', error);
      toast({
        title: 'Fehler',
        description: 'Kontakt konnte nicht gelöscht werden.',
        variant: 'destructive',
      });
      return false;
    }
  };

  const markLetterSent = async (id: string) => {
    return updateContact(id, {
      stage: 'letter_sent',
      letter_sent_date: new Date().toISOString(),
    });
  };

  const importContacts = async (contactsToImport: DmcContactInsert[]) => {
    if (!user) return false;

    try {
      const contactsWithUserId = contactsToImport.map(contact => ({
        ...contact,
        user_id: user.id,
      }));

      const { data, error } = await supabase
        .from('dmc_contacts')
        .insert(contactsWithUserId)
        .select();

      if (error) throw error;

      const typedData = (data || []).map(contact => ({
        ...contact,
        stage: contact.stage as DmcStage,
      }));

      setContacts(prev => [...typedData, ...prev]);
      toast({
        title: 'Import erfolgreich',
        description: `${contactsToImport.length} Kontakte wurden importiert.`,
      });
      return true;
    } catch (error) {
      console.error('Error importing DMC contacts:', error);
      toast({
        title: 'Fehler',
        description: 'Kontakte konnten nicht importiert werden.',
        variant: 'destructive',
      });
      return false;
    }
  };

  return {
    contacts,
    isLoading,
    addContact,
    updateContact,
    deleteContact,
    markLetterSent,
    importContacts,
    refetch: fetchContacts,
  };
}
