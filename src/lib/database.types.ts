export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      admin_credentials: {
        Row: {
          created_at: string;
          id: string;
          password_hash: string;
          rotated_at: string | null;
          username: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          password_hash: string;
          rotated_at?: string | null;
          username: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          password_hash?: string;
          rotated_at?: string | null;
          username?: string;
        };
        Relationships: [];
      };
      drivers: {
        Row: {
          best_lap_ms: number | null;
          driver_flag: string | null;
          id: string;
          laps: number | null;
          last_lap_ms: number | null;
          marshal_user_id: string | null;
          name: string;
          number: number;
          pit_complete: boolean | null;
          pits: number | null;
          session_id: string;
          status: string | null;
          team: string | null;
          total_time_ms: number | null;
          updated_at: string | null;
        };
        Insert: {
          best_lap_ms?: number | null;
          driver_flag?: string | null;
          id: string;
          laps?: number | null;
          last_lap_ms?: number | null;
          marshal_user_id?: string | null;
          name: string;
          number: number;
          pit_complete?: boolean | null;
          pits?: number | null;
          session_id?: string;
          status?: string | null;
          team?: string | null;
          total_time_ms?: number | null;
          updated_at?: string | null;
        };
        Update: {
          best_lap_ms?: number | null;
          driver_flag?: string | null;
          id?: string;
          laps?: number | null;
          last_lap_ms?: number | null;
          marshal_user_id?: string | null;
          name?: string;
          number?: number;
          pit_complete?: boolean | null;
          pits?: number | null;
          session_id?: string;
          status?: string | null;
          team?: string | null;
          total_time_ms?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'drivers_marshal_user_id_fkey';
            columns: ['marshal_user_id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'drivers_session_id_fkey';
            columns: ['session_id'];
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      laps: {
        Row: {
          checkpoint_missed: boolean | null;
          driver_id: string | null;
          id: string;
          invalidated: boolean | null;
          lap_number: number;
          lap_time_ms: number;
          recorded_at: string | null;
          session_id: string;
          source: string | null;
        };
        Insert: {
          checkpoint_missed?: boolean | null;
          driver_id?: string | null;
          id?: string;
          invalidated?: boolean | null;
          lap_number: number;
          lap_time_ms: number;
          recorded_at?: string | null;
          session_id?: string;
          source?: string | null;
        };
        Update: {
          checkpoint_missed?: boolean | null;
          driver_id?: string | null;
          id?: string;
          invalidated?: boolean | null;
          lap_number?: number;
          lap_time_ms?: number;
          recorded_at?: string | null;
          session_id?: string;
          source?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'laps_driver_id_fkey';
            columns: ['driver_id'];
            referencedRelation: 'drivers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'laps_session_id_fkey';
            columns: ['session_id'];
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          assigned_driver_ids: string[] | null;
          created_at: string | null;
          display_name: string | null;
          experience_points: number | null;
          handle: string | null;
          ic_phone_number: string | null;
          id: string;
          role: Database['public']['Enums']['profile_role'] | null;
          team_id: string | null;
          tier: string | null;
          updated_at: string | null;
        };
        Insert: {
          assigned_driver_ids?: string[] | null;
          created_at?: string | null;
          display_name?: string | null;
          experience_points?: number | null;
          handle?: string | null;
          ic_phone_number?: string | null;
          id: string;
          role?: Database['public']['Enums']['profile_role'] | null;
          team_id?: string | null;
          tier?: string | null;
          updated_at?: string | null;
        };
        Update: {
          assigned_driver_ids?: string[] | null;
          created_at?: string | null;
          display_name?: string | null;
          experience_points?: number | null;
          handle?: string | null;
          ic_phone_number?: string | null;
          id?: string;
          role?: Database['public']['Enums']['profile_role'] | null;
          team_id?: string | null;
          tier?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey';
            columns: ['id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      race_events: {
        Row: {
          created_at: string | null;
          id: string;
          marshal_id: string | null;
          message: string;
          session_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          marshal_id?: string | null;
          message: string;
          session_id?: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          marshal_id?: string | null;
          message?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'race_events_session_id_fkey';
            columns: ['session_id'];
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      session_logs: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          format: string | null;
          id: string;
          object_path: string;
          object_url: string | null;
          session_id: string;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          format?: string | null;
          id?: string;
          object_path: string;
          object_url?: string | null;
          session_id: string;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          format?: string | null;
          id?: string;
          object_path?: string;
          object_url?: string | null;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_logs_session_id_fkey';
            columns: ['session_id'];
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      session_members: {
        Row: {
          inserted_at: string | null;
          role: string | null;
          session_id: string;
          user_id: string;
        };
        Insert: {
          inserted_at?: string | null;
          role?: string | null;
          session_id: string;
          user_id: string;
        };
        Update: {
          inserted_at?: string | null;
          role?: string | null;
          session_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_members_session_id_fkey';
            columns: ['session_id'];
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'session_members_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      session_state: {
        Row: {
          announcement: string | null;
          event_type: string | null;
          flag_status: string | null;
          id: string;
          is_paused: boolean | null;
          is_timing: boolean | null;
          procedure_phase: string | null;
          race_time_ms: number | null;
          session_id: string;
          total_duration: number | null;
          total_laps: number | null;
          track_status: string | null;
          updated_at: string | null;
        };
        Insert: {
          announcement?: string | null;
          event_type?: string | null;
          flag_status?: string | null;
          id: string;
          is_paused?: boolean | null;
          is_timing?: boolean | null;
          procedure_phase?: string | null;
          race_time_ms?: number | null;
          session_id?: string;
          total_duration?: number | null;
          total_laps?: number | null;
          track_status?: string | null;
          updated_at?: string | null;
        };
        Update: {
          announcement?: string | null;
          event_type?: string | null;
          flag_status?: string | null;
          id?: string;
          is_paused?: boolean | null;
          is_timing?: boolean | null;
          procedure_phase?: string | null;
          race_time_ms?: number | null;
          session_id?: string;
          total_duration?: number | null;
          total_laps?: number | null;
          track_status?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'session_state_session_id_fkey';
            columns: ['session_id'];
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      sessions: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          ends_at: string | null;
          id: string;
          name: string;
          starts_at: string | null;
          status: string | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          name: string;
          starts_at?: string | null;
          status?: string | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          name?: string;
          starts_at?: string | null;
          status?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      invalidate_last_lap_atomic: {
        Args: {
          p_session_id: string;
          p_driver_id: string;
          p_mode?: string;
        };
        Returns: {
          invalidated_lap_id: string;
          session_id: string;
          driver_id: string;
          laps: number | null;
          last_lap_ms: number | null;
          best_lap_ms: number | null;
          total_time_ms: number | null;
        }[];
      };
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      log_lap_atomic: {
        Args: {
          p_session_id: string;
          p_driver_id: string;
          p_lap_time_ms: number;
          p_source?: string;
        };
        Returns: {
          lap_id: string;
          session_id: string;
          driver_id: string;
          laps: number | null;
          last_lap_ms: number | null;
          best_lap_ms: number | null;
          total_time_ms: number | null;
        }[];
      };
      session_has_access: {
        Args: {
          target_session_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      profile_role: 'marshal' | 'admin' | 'race_control';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
