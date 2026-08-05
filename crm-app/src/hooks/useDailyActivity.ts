import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface DailyActivity {
  id: string;
  date: string;
  contact_count: number;
}

export function useDailyActivity() {
  const { user } = useAuth();
  const [activities, setActivities] = useState<DailyActivity[]>([]);

  const fetchActivities = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('daily_activity')
      .select('id, date, contact_count')
      .order('date', { ascending: false });

    if (error) {
      console.error('Error fetching daily activity:', error);
      return;
    }
    setActivities((data as DailyActivity[]) || []);
  }, [user]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const upsertActivity = useCallback(async (date: string, contactCount: number) => {
    if (!user) return;

    const existing = activities.find(a => a.date === date);

    if (existing) {
      const { error } = await supabase
        .from('daily_activity')
        .update({ contact_count: contactCount } as any)
        .eq('id', existing.id);
      if (error) {
        toast.error('Fehler beim Speichern');
        return;
      }
    } else {
      const { error } = await supabase
        .from('daily_activity')
        .insert({ user_id: user.id, date, contact_count: contactCount } as any);
      if (error) {
        toast.error('Fehler beim Speichern');
        return;
      }
    }

    toast.success('Aktivität gespeichert');
    fetchActivities();
  }, [user, activities, fetchActivities]);

  const getCountForDate = useCallback((date: string): number | null => {
    const activity = activities.find(a => a.date === date);
    return activity ? activity.contact_count : null;
  }, [activities]);

  return { activities, upsertActivity, getCountForDate };
}
