export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      contact_logs: {
        Row: {
          comment: string | null
          created_at: string
          date: string
          id: string
          lead_id: string
          reached_customer: boolean | null
          type: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          date?: string
          id?: string
          lead_id: string
          reached_customer?: boolean | null
          type: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          date?: string
          id?: string
          lead_id?: string
          reached_customer?: boolean | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_activity: {
        Row: {
          contact_count: number
          created_at: string
          date: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_count?: number
          created_at?: string
          date: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_count?: number
          created_at?: string
          date?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dmc_contacts: {
        Row: {
          ceo_name: string | null
          city: string | null
          company_name: string
          contact_notes: string | null
          created_at: string
          email: string | null
          first_contact_date: string | null
          id: string
          letter_sent_date: string | null
          phone: string | null
          postal_code: string | null
          region: string | null
          source_url: string | null
          stage: string
          street: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ceo_name?: string | null
          city?: string | null
          company_name: string
          contact_notes?: string | null
          created_at?: string
          email?: string | null
          first_contact_date?: string | null
          id?: string
          letter_sent_date?: string | null
          phone?: string | null
          postal_code?: string | null
          region?: string | null
          source_url?: string | null
          stage?: string
          street?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ceo_name?: string | null
          city?: string | null
          company_name?: string
          contact_notes?: string | null
          created_at?: string
          email?: string | null
          first_contact_date?: string | null
          id?: string
          letter_sent_date?: string | null
          phone?: string | null
          postal_code?: string | null
          region?: string | null
          source_url?: string | null
          stage?: string
          street?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          ad_name: string | null
          callback_comment: string | null
          callback_date: string | null
          callback_set_at: string | null
          campaign_name: string | null
          company_name: string | null
          created_at: string
          customer_wishes: string | null
          email: string | null
          full_name: string
          has_more_than_5_employees: boolean | null
          id: string
          is_entrepreneur: boolean | null
          meeting_appeared: boolean | null
          meeting_date: string | null
          offer_id: string | null
          phone: string | null
          platform: string | null
          qualification_notes: string | null
          sale_amount: number | null
          source: string
          stage: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_name?: string | null
          callback_comment?: string | null
          callback_date?: string | null
          callback_set_at?: string | null
          campaign_name?: string | null
          company_name?: string | null
          created_at?: string
          customer_wishes?: string | null
          email?: string | null
          full_name: string
          has_more_than_5_employees?: boolean | null
          id?: string
          is_entrepreneur?: boolean | null
          meeting_appeared?: boolean | null
          meeting_date?: string | null
          offer_id?: string | null
          phone?: string | null
          platform?: string | null
          qualification_notes?: string | null
          sale_amount?: number | null
          source?: string
          stage?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_name?: string | null
          callback_comment?: string | null
          callback_date?: string | null
          callback_set_at?: string | null
          campaign_name?: string | null
          company_name?: string | null
          created_at?: string
          customer_wishes?: string | null
          email?: string | null
          full_name?: string
          has_more_than_5_employees?: boolean | null
          id?: string
          is_entrepreneur?: boolean | null
          meeting_appeared?: boolean | null
          meeting_date?: string | null
          offer_id?: string | null
          phone?: string | null
          platform?: string | null
          qualification_notes?: string | null
          sale_amount?: number | null
          source?: string
          stage?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      order_volumes: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          month: number
          source: string | null
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          month: number
          source?: string | null
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          month?: number
          source?: string | null
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
