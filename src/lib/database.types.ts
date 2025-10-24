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
          status?: string | null;
          team?: string | null;
          total_time_ms?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "drivers_marshal_user_id_fkey";
            columns: ["marshal_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
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
          source: string | null;
        };
        Insert: {
          driver_id?: string | null;
          id?: string;
          lap_number: number;
          lap_time_ms: number;
          recorded_at?: string | null;
          source?: string | null;
        };
        Update: {
          driver_id?: string | null;
          id?: string;
          lap_number?: number;
          lap_time_ms?: number;
          recorded_at?: string | null;
          source?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "laps_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          assigned_driver_ids: string[] | null;
          created_at: string | null;
          display_name: string | null;
          id: string;
          role: string;
          team_id: string | null;
          updated_at: string | null;
        };
        Insert: {
          assigned_driver_ids?: string[] | null;
          created_at?: string | null;
          display_name?: string | null;
          id: string;
          role?: string;
          team_id?: string | null;
          updated_at?: string | null;
        };
        Update: {
          assigned_driver_ids?: string[] | null;
          created_at?: string | null;
          display_name?: string | null;
          id?: string;
          role?: string;
          team_id?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      race_events: {
        Row: {
          created_at: string | null;
          id: string;
          marshal_id: string | null;
          message: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          marshal_id?: string | null;
          message: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          marshal_id?: string | null;
          message?: string;
        };
        Relationships: [];
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
          total_duration?: number | null;
          total_laps?: number | null;
          track_status?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
}
