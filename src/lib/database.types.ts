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
      drivers: {
        Row: {
          best_lap_ms: number | null;
          driver_flag: string | null;
          id: string;
          last_lap_ms: number | null;
          laps: number | null;
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
          id?: string;
          last_lap_ms?: number | null;
          laps?: number | null;
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
          last_lap_ms?: number | null;
          laps?: number | null;
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
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'drivers_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      laps: {
        Row: {
          driver_id: string | null;
          id: string;
          lap_number: number;
          lap_time_ms: number;
          recorded_at: string | null;
          session_id: string;
          source: string | null;
        };
        Insert: {
          driver_id?: string | null;
          id?: string;
          lap_number: number;
          lap_time_ms: number;
          recorded_at?: string | null;
          session_id?: string;
          source?: string | null;
        };
        Update: {
          driver_id?: string | null;
          id?: string;
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
            isOneToOne: false;
            referencedRelation: 'drivers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'laps_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
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
          experience_points: number;
          ic_phone_number: string | null;
          id: string;
          role: string;
          team_id: string | null;
          tier: string | null;
          updated_at: string | null;
        };
        Insert: {
          assigned_driver_ids?: string[] | null;
          created_at?: string | null;
          display_name?: string | null;
          experience_points?: number;
          ic_phone_number?: string | null;
          id: string;
          role?: string;
          team_id?: string | null;
          tier?: string | null;
          updated_at?: string | null;
        };
        Update: {
          assigned_driver_ids?: string[] | null;
          created_at?: string | null;
          display_name?: string | null;
          experience_points?: number;
          ic_phone_number?: string | null;
          id?: string;
          role?: string;
          team_id?: string | null;
          tier?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey';
            columns: ['id'];
            isOneToOne: true;
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
            isOneToOne: false;
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      session_entries: {
        Row: {
          created_at: string | null;
          driver_id: string | null;
          driver_name: string | null;
          driver_number: number | null;
          id: string;
          marshal_user_id: string | null;
          position: number | null;
          session_id: string;
          team_name: string | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          driver_id?: string | null;
          driver_name?: string | null;
          driver_number?: number | null;
          id?: string;
          marshal_user_id?: string | null;
          position?: number | null;
          session_id?: string;
          team_name?: string | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          driver_id?: string | null;
          driver_name?: string | null;
          driver_number?: number | null;
          id?: string;
          marshal_user_id?: string | null;
          position?: number | null;
          session_id?: string;
          team_name?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'session_entries_driver_id_fkey';
            columns: ['driver_id'];
            isOneToOne: false;
            referencedRelation: 'drivers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'session_entries_marshal_user_id_fkey';
            columns: ['marshal_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'session_entries_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      session_logs: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          format: string;
          id: string;
          object_path: string;
          object_url: string | null;
          session_id: string;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          format?: string;
          id?: string;
          object_path: string;
          object_url?: string | null;
          session_id?: string;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          format?: string;
          id?: string;
          object_path?: string;
          object_url?: string | null;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_logs_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      session_members: {
        Row: {
          inserted_at: string | null;
          role: string;
          session_id: string;
          user_id: string;
        };
        Insert: {
          inserted_at?: string | null;
          role?: string;
          session_id: string;
          user_id: string;
        };
        Update: {
          inserted_at?: string | null;
          role?: string;
          session_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_members_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'session_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
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
            isOneToOne: false;
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
          status: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          name: string;
          starts_at?: string | null;
          status?: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          name?: string;
          starts_at?: string | null;
          status?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sessions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
}
