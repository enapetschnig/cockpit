import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface OrderVolume {
  id: string;
  user_id: string;
  year: number;
  month: number;
  amount: number;
  source: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export function useOrderVolumes(year: number) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: orderVolumes = [], isLoading } = useQuery({
    queryKey: ['order-volumes', year, user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const { data, error } = await supabase
        .from('order_volumes')
        .select('*')
        .eq('user_id', user.id)
        .eq('year', year)
        .order('month', { ascending: true });

      if (error) throw error;
      return data as OrderVolume[];
    },
    enabled: !!user,
  });

  const yearlyTotal = orderVolumes.reduce((sum, vol) => sum + Number(vol.amount), 0);

  const addVolume = useMutation({
    mutationFn: async ({ month, amount, source, description }: { month: number; amount: number; source?: string; description?: string }) => {
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('order_volumes')
        .insert({ user_id: user.id, year, month, amount, source, description });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-volumes'] });
      queryClient.invalidateQueries({ queryKey: ['order-volumes-total'] });
    },
  });

  const updateVolume = useMutation({
    mutationFn: async ({ id, amount, source, description }: { id: string; amount: number; source?: string; description?: string }) => {
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('order_volumes')
        .update({ amount, source, description })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-volumes'] });
      queryClient.invalidateQueries({ queryKey: ['order-volumes-total'] });
    },
  });

  const deleteVolume = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('order_volumes')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-volumes'] });
      queryClient.invalidateQueries({ queryKey: ['order-volumes-total'] });
    },
  });

  return {
    orderVolumes,
    isLoading,
    yearlyTotal,
    addVolume,
    updateVolume,
    deleteVolume,
  };
}

export function useCurrentYearTotal() {
  const { user } = useAuth();
  const currentYear = new Date().getFullYear();

  const { data: yearlyTotal = 0 } = useQuery({
    queryKey: ['order-volumes-total', currentYear, user?.id],
    queryFn: async () => {
      if (!user) return 0;
      
      const { data, error } = await supabase
        .from('order_volumes')
        .select('amount')
        .eq('user_id', user.id)
        .eq('year', currentYear);

      if (error) throw error;
      return data.reduce((sum, vol) => sum + Number(vol.amount), 0);
    },
    enabled: !!user,
  });

  return yearlyTotal;
}
