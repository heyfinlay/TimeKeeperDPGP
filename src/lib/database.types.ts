Initialising login role...
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
    PostgrestVersion: "13.0.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_actions_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          market_id: string | null
          meta: Json | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          market_id?: string | null
          meta?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          market_id?: string | null
          meta?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_actions_log_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_credentials: {
        Row: {
          created_at: string
          id: string
          password_hash: string
          rotated_at: string | null
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          password_hash: string
          rotated_at?: string | null
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          password_hash?: string
          rotated_at?: string | null
          username?: string
        }
        Relationships: []
      }
      control_logs: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          id: string
          payload: Json | null
          session_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          session_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "control_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          best_lap_ms: number | null
          driver_flag: string | null
          id: string
          laps: number | null
          last_lap_ms: number | null
          marshal_user_id: string | null
          name: string
          number: number
          pit_complete: boolean | null
          pits: number | null
          session_id: string
          status: string | null
          team: string | null
          total_time_ms: number | null
          updated_at: string | null
        }
        Insert: {
          best_lap_ms?: number | null
          driver_flag?: string | null
          id: string
          laps?: number | null
          last_lap_ms?: number | null
          marshal_user_id?: string | null
          name: string
          number: number
          pit_complete?: boolean | null
          pits?: number | null
          session_id: string
          status?: string | null
          team?: string | null
          total_time_ms?: number | null
          updated_at?: string | null
        }
        Update: {
          best_lap_ms?: number | null
          driver_flag?: string | null
          id?: string
          laps?: number | null
          last_lap_ms?: number | null
          marshal_user_id?: string | null
          name?: string
          number?: number
          pit_complete?: boolean | null
          pits?: number | null
          session_id?: string
          status?: string | null
          team?: string | null
          total_time_ms?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers_marshal_map: {
        Row: {
          marshal_id_legacy: string
          user_id: string
        }
        Insert: {
          marshal_id_legacy: string
          user_id: string
        }
        Update: {
          marshal_id_legacy?: string
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          ends_at: string | null
          id: string
          session_id: string | null
          starts_at: string | null
          status: string
          title: string
          venue: string | null
        }
        Insert: {
          ends_at?: string | null
          id?: string
          session_id?: string | null
          starts_at?: string | null
          status?: string
          title: string
          venue?: string | null
        }
        Update: {
          ends_at?: string | null
          id?: string
          session_id?: string | null
          starts_at?: string | null
          status?: string
          title?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      laps: {
        Row: {
          checkpoint_missed: boolean | null
          driver_id: string | null
          id: string
          invalidated: boolean | null
          lap_number: number
          lap_time_ms: number
          recorded_at: string | null
          session_id: string
          source: string | null
        }
        Insert: {
          checkpoint_missed?: boolean | null
          driver_id?: string | null
          id?: string
          invalidated?: boolean | null
          lap_number: number
          lap_time_ms: number
          recorded_at?: string | null
          session_id: string
          source?: string | null
        }
        Update: {
          checkpoint_missed?: boolean | null
          driver_id?: string | null
          id?: string
          invalidated?: boolean | null
          lap_number?: number
          lap_time_ms?: number
          recorded_at?: string | null
          session_id?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "laps_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "laps_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      markets: {
        Row: {
          closes_at: string | null
          created_at: string
          event_id: string
          id: string
          name: string
          rake_bps: number
          status: string
          type: string
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          event_id: string
          id?: string
          name: string
          rake_bps?: number
          status?: string
          type: string
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          event_id?: string
          id?: string
          name?: string
          rake_bps?: number
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "markets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      outcomes: {
        Row: {
          color: string | null
          driver_id: string | null
          id: string
          label: string
          market_id: string
          sort_order: number
        }
        Insert: {
          color?: string | null
          driver_id?: string | null
          id?: string
          label: string
          market_id: string
          sort_order?: number
        }
        Update: {
          color?: string | null
          driver_id?: string | null
          id?: string
          label?: string
          market_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "outcomes_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      penalties: {
        Row: {
          category: string
          created_at: string
          driver_id: string
          id: string
          issued_by: string | null
          reason: string | null
          session_id: string
          time_penalty_ms: number
        }
        Insert: {
          category: string
          created_at?: string
          driver_id: string
          id?: string
          issued_by?: string | null
          reason?: string | null
          session_id: string
          time_penalty_ms?: number
        }
        Update: {
          category?: string
          created_at?: string
          driver_id?: string
          id?: string
          issued_by?: string | null
          reason?: string | null
          session_id?: string
          time_penalty_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "penalties_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalties_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      pit_events: {
        Row: {
          driver_id: string
          duration_ms: number | null
          event_type: string
          id: string
          recorded_by: string | null
          session_id: string
          timestamp: string
        }
        Insert: {
          driver_id: string
          duration_ms?: number | null
          event_type: string
          id?: string
          recorded_by?: string | null
          session_id: string
          timestamp?: string
        }
        Update: {
          driver_id?: string
          duration_ms?: number | null
          event_type?: string
          id?: string
          recorded_by?: string | null
          session_id?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "pit_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pit_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          assigned_driver_ids: string[] | null
          created_at: string | null
          display_name: string | null
          driver_ids: string[] | null
          experience_points: number
          handle: string | null
          ic_phone_number: string | null
          id: string
          role: string
          team_id: string | null
          tier: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_driver_ids?: string[] | null
          created_at?: string | null
          display_name?: string | null
          driver_ids?: string[] | null
          experience_points?: number
          handle?: string | null
          ic_phone_number?: string | null
          id: string
          role?: string
          team_id?: string | null
          tier?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_driver_ids?: string[] | null
          created_at?: string | null
          display_name?: string | null
          driver_ids?: string[] | null
          experience_points?: number
          handle?: string | null
          ic_phone_number?: string | null
          id?: string
          role?: string
          team_id?: string | null
          tier?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      race_events: {
        Row: {
          created_at: string | null
          id: string
          marshal_id: string | null
          message: string
          session_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          marshal_id?: string | null
          message: string
          session_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          marshal_id?: string | null
          message?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      results_final: {
        Row: {
          best_lap_ms: number | null
          classification: string
          created_at: string
          driver_id: string
          final_position: number
          final_time_ms: number | null
          session_id: string
          total_laps: number
          total_penalty_ms: number
          total_time_ms: number | null
          validated: boolean
        }
        Insert: {
          best_lap_ms?: number | null
          classification?: string
          created_at?: string
          driver_id: string
          final_position: number
          final_time_ms?: number | null
          session_id: string
          total_laps?: number
          total_penalty_ms?: number
          total_time_ms?: number | null
          validated?: boolean
        }
        Update: {
          best_lap_ms?: number | null
          classification?: string
          created_at?: string
          driver_id?: string
          final_position?: number
          final_time_ms?: number | null
          session_id?: string
          total_laps?: number
          total_penalty_ms?: number
          total_time_ms?: number | null
          validated?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "results_final_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "results_final_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_entries: {
        Row: {
          created_at: string
          driver_id: string
          session_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          session_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_entries_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_logs: {
        Row: {
          created_at: string | null
          created_by: string | null
          format: string
          id: string
          object_path: string
          object_url: string | null
          session_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          format?: string
          id?: string
          object_path: string
          object_url?: string | null
          session_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          format?: string
          id?: string
          object_path?: string
          object_url?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_members: {
        Row: {
          inserted_at: string
          role: string
          session_id: string
          user_id: string
        }
        Insert: {
          inserted_at?: string
          role?: string
          session_id: string
          user_id: string
        }
        Update: {
          inserted_at?: string
          role?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_members_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_state: {
        Row: {
          accumulated_pause_ms: number
          announcement: string | null
          event_type: string | null
          flag_status: string | null
          id: string
          is_paused: boolean | null
          is_timing: boolean | null
          pause_started_at: string | null
          procedure_phase: string | null
          race_started_at: string | null
          race_time_ms: number | null
          session_id: string
          total_duration: number | null
          total_laps: number | null
          track_status: string | null
          updated_at: string | null
        }
        Insert: {
          accumulated_pause_ms?: number
          announcement?: string | null
          event_type?: string | null
          flag_status?: string | null
          id: string
          is_paused?: boolean | null
          is_timing?: boolean | null
          pause_started_at?: string | null
          procedure_phase?: string | null
          race_started_at?: string | null
          race_time_ms?: number | null
          session_id: string
          total_duration?: number | null
          total_laps?: number | null
          track_status?: string | null
          updated_at?: string | null
        }
        Update: {
          accumulated_pause_ms?: number
          announcement?: string | null
          event_type?: string | null
          flag_status?: string | null
          id?: string
          is_paused?: boolean | null
          is_timing?: boolean | null
          pause_started_at?: string | null
          procedure_phase?: string | null
          race_started_at?: string | null
          race_time_ms?: number | null
          session_id?: string
          total_duration?: number | null
          total_laps?: number | null
          track_status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_state_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          created_at: string | null
          created_by: string | null
          ends_at: string | null
          id: string
          is_final: boolean
          locked_marshal_uuid: string | null
          name: string
          session_mode: string
          single_marshal_mode: boolean
          starts_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          ends_at?: string | null
          id?: string
          is_final?: boolean
          locked_marshal_uuid?: string | null
          name: string
          session_mode?: string
          single_marshal_mode?: boolean
          starts_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          ends_at?: string | null
          id?: string
          is_final?: boolean
          locked_marshal_uuid?: string | null
          name?: string
          session_mode?: string
          single_marshal_mode?: boolean
          starts_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      wagers: {
        Row: {
          id: string
          market_id: string
          outcome_id: string
          placed_at: string
          stake: number
          status: string
          user_id: string
        }
        Insert: {
          id?: string
          market_id: string
          outcome_id: string
          placed_at?: string
          stake: number
          status?: string
          user_id: string
        }
        Update: {
          id?: string
          market_id?: string
          outcome_id?: string
          placed_at?: string
          stake?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wagers_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wagers_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: false
            referencedRelation: "outcomes"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_accounts: {
        Row: {
          balance: number
          user_id: string
        }
        Insert: {
          balance?: number
          user_id: string
        }
        Update: {
          balance?: number
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          kind: string
          meta: Json | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          kind: string
          meta?: Json | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          kind?: string
          meta?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      deposits: {
        Row: {
          amount: number
          created_at: string
          ic_phone_number: string | null
          id: string
          reference_code: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          ic_phone_number?: string | null
          id?: string
          reference_code?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          ic_phone_number?: string | null
          id?: string
          reference_code?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          amount: number
          created_at: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      my_profile: {
        Row: {
          id: string | null
          role: string | null
          team_id: string | null
        }
        Insert: {
          id?: string | null
          role?: string | null
          team_id?: string | null
        }
        Update: {
          id?: string | null
          role?: string | null
          team_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      adjust_wallet_balance: {
        Args: {
          p_amount: number
          p_kind?: string
          p_memo?: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_adjust_wallet: {
        Args: {
          p_amount: number
          p_kind?: string
          p_memo?: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_create_market: {
        Args: {
          p_closes_at?: string
          p_market_name: string
          p_market_type?: string
          p_outcomes: Json
          p_rake_bps?: number
          p_session_id: string
        }
        Returns: Json
      }
      admin_process_withdrawal: {
        Args: { p_approve: boolean; p_memo?: string; p_withdrawal_id: string }
        Returns: undefined
      }
      apply_penalty: {
        Args: {
          p_category: string
          p_driver_id: string
          p_reason?: string
          p_session_id: string
          p_time_penalty_ms: number
        }
        Returns: string
      }
      approve_withdrawal: { Args: { p_withdrawal_id: string }; Returns: Json }
      close_market: { Args: { p_market_id: string }; Returns: Json }
      create_session_atomic: { Args: { p_session: Json }; Returns: string }
      ensure_session_member: {
        Args: { p_role?: string; p_session_id: string; p_user_id: string }
        Returns: undefined
      }
      finalize_session_results: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      finish_race_rpc: { Args: { p_session_id: string }; Returns: undefined }
      invalidate_last_lap_atomic: {
        Args: { p_driver_id: string; p_mode?: string; p_session_id: string }
        Returns: {
          best_lap_ms: number
          driver_id: string
          invalidated_lap_id: string
          laps: number
          last_lap_ms: number
          session_id: string
          total_time_ms: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      log_admin_action: {
        Args: { p_action: string; p_market_id?: string; p_meta?: Json }
        Returns: undefined
      }
      log_lap_atomic: {
        Args: {
          p_driver_id: string
          p_lap_time_ms: number
          p_session_id: string
          p_source?: string
        }
        Returns: {
          best_lap_ms: number
          driver_id: string
          lap_id: string
          laps: number
          last_lap_ms: number
          session_id: string
          total_time_ms: number
        }[]
      }
      log_pit_event: {
        Args: {
          p_driver_id: string
          p_event_type: string
          p_session_id: string
        }
        Returns: string
      }
      pause_race_rpc: { Args: { p_session_id: string }; Returns: undefined }
      place_wager: {
        Args: { p_market_id: string; p_outcome_id: string; p_stake: number }
        Returns: Json
      }
      reject_withdrawal: {
        Args: { p_reason?: string; p_withdrawal_id: string }
        Returns: Json
      }
      remove_session_member: {
        Args: { p_role?: string; p_session_id: string; p_user_id: string }
        Returns: undefined
      }
      request_withdrawal: {
        Args: { p_amount: number }
        Returns: Json
      }
      request_deposit: {
        Args: { p_amount: number; p_phone?: string | null; p_reference?: string | null }
        Returns: Json
      }
      resume_race_rpc: { Args: { p_session_id: string }; Returns: undefined }
      session_has_access: {
        Args: { target_session_id: string }
        Returns: boolean
      }
      session_state_has_access: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      settle_market: {
        Args: {
          p_market_id: string
          p_payout_policy?: string
          p_winning_outcome_id: string
        }
        Returns: Json
      }
      start_race_rpc: { Args: { p_session_id: string }; Returns: undefined }
    }
    Enums: {
      profile_role: "marshal" | "admin" | "race_control"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      profile_role: ["marshal", "admin", "race_control"],
    },
  },
} as const
A new version of Supabase CLI is available: v2.58.5 (currently installed v2.54.11)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
