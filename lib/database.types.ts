export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      class_invite_codes: {
        Row: {
          class_id: string
          code: string
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          revoked_at: string | null
          use_count: number
        }
        Insert: {
          class_id: string
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          revoked_at?: string | null
          use_count?: number
        }
        Update: {
          class_id?: string
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          revoked_at?: string | null
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "class_invite_codes_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      class_materials: {
        Row: {
          byte_size: number
          class_id: string
          created_at: string
          file_name: string
          id: string
          mime_type: string
          session_id: string | null
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          byte_size: number
          class_id: string
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          session_id?: string | null
          storage_path: string
          uploaded_by: string
        }
        Update: {
          byte_size?: number
          class_id?: string
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          session_id?: string | null
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_materials_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_materials_session_fk"
            columns: ["session_id", "class_id"]
            isOneToOne: false
            referencedRelation: "class_sessions"
            referencedColumns: ["id", "class_id"]
          },
          {
            foreignKeyName: "class_materials_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_members: {
        Row: {
          class_id: string
          created_at: string
          focus_areas: string[]
          id: string
          invite_email_sent_at: string | null
          invite_reminder_count: number
          invited_at: string | null
          invited_email: string | null
          invited_name: string | null
          join_status: Database["public"]["Enums"]["join_status"]
          joined_at: string | null
          removed_at: string | null
          strengths: string[]
          student_id: string | null
          target_band: number | null
          tuition_rate_per_session: number | null
          updated_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          focus_areas?: string[]
          id?: string
          invite_email_sent_at?: string | null
          invite_reminder_count?: number
          invited_at?: string | null
          invited_email?: string | null
          invited_name?: string | null
          join_status?: Database["public"]["Enums"]["join_status"]
          joined_at?: string | null
          removed_at?: string | null
          strengths?: string[]
          student_id?: string | null
          target_band?: number | null
          tuition_rate_per_session?: number | null
          updated_at?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          focus_areas?: string[]
          id?: string
          invite_email_sent_at?: string | null
          invite_reminder_count?: number
          invited_at?: string | null
          invited_email?: string | null
          invited_name?: string | null
          join_status?: Database["public"]["Enums"]["join_status"]
          joined_at?: string | null
          removed_at?: string | null
          strengths?: string[]
          student_id?: string | null
          target_band?: number | null
          tuition_rate_per_session?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_members_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_members_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_sessions: {
        Row: {
          cancelled_reason: string | null
          class_id: string
          created_at: string
          ends_at: string
          id: string
          location: string | null
          starts_at: string
          status: Database["public"]["Enums"]["session_status"]
          title: string | null
          updated_at: string
        }
        Insert: {
          cancelled_reason?: string | null
          class_id: string
          created_at?: string
          ends_at: string
          id?: string
          location?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["session_status"]
          title?: string | null
          updated_at?: string
        }
        Update: {
          cancelled_reason?: string | null
          class_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          location?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_sessions_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          archived_at: string | null
          course_type: Database["public"]["Enums"]["course_type"]
          course_type_other: string | null
          created_at: string
          default_tuition_rate_per_session: number | null
          description: string | null
          end_date: string | null
          id: string
          name: string
          schedule_note: string | null
          scoring_model: Database["public"]["Enums"]["scoring_model"]
          start_date: string
          target_band: number | null
          teacher_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          course_type: Database["public"]["Enums"]["course_type"]
          course_type_other?: string | null
          created_at?: string
          default_tuition_rate_per_session?: number | null
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          schedule_note?: string | null
          scoring_model?: Database["public"]["Enums"]["scoring_model"]
          start_date: string
          target_band?: number | null
          teacher_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          course_type?: Database["public"]["Enums"]["course_type"]
          course_type_other?: string | null
          created_at?: string
          default_tuition_rate_per_session?: number | null
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          schedule_note?: string | null
          scoring_model?: Database["public"]["Enums"]["scoring_model"]
          start_date?: string
          target_band?: number | null
          teacher_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_assignments: {
        Row: {
          assigned_on: string
          class_id: string
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          max_score: number
          session_id: string | null
          skill: Database["public"]["Enums"]["skill"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_on?: string
          class_id: string
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          max_score?: number
          session_id?: string | null
          skill: Database["public"]["Enums"]["skill"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_on?: string
          class_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          max_score?: number
          session_id?: string | null
          skill?: Database["public"]["Enums"]["skill"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_assignments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_session_fk"
            columns: ["session_id", "class_id"]
            isOneToOne: false
            referencedRelation: "class_sessions"
            referencedColumns: ["id", "class_id"]
          },
        ]
      }
      homework_submissions: {
        Row: {
          assignment_id: string
          class_id: string
          class_member_id: string
          created_at: string
          graded_at: string | null
          id: string
          score: number | null
          status: Database["public"]["Enums"]["homework_status"]
          submitted_at: string | null
          teacher_feedback: string | null
          updated_at: string
        }
        Insert: {
          assignment_id: string
          class_id: string
          class_member_id: string
          created_at?: string
          graded_at?: string | null
          id?: string
          score?: number | null
          status?: Database["public"]["Enums"]["homework_status"]
          submitted_at?: string | null
          teacher_feedback?: string | null
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          class_id?: string
          class_member_id?: string
          created_at?: string
          graded_at?: string | null
          id?: string
          score?: number | null
          status?: Database["public"]["Enums"]["homework_status"]
          submitted_at?: string | null
          teacher_feedback?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_submissions_assignment_fk"
            columns: ["assignment_id", "class_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id", "class_id"]
          },
          {
            foreignKeyName: "homework_submissions_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "class_members"
            referencedColumns: ["id", "class_id"]
          },
          {
            foreignKeyName: "homework_submissions_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_attendance_summary"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "homework_submissions_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_current_band"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "homework_submissions_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_performance_status"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "homework_submissions_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_session_attendance"
            referencedColumns: ["class_member_id", "class_id"]
          },
        ]
      }
      lesson_logs: {
        Row: {
          class_id: string
          class_member_id: string
          created_at: string
          created_by: string
          id: string
          lesson_date: string
          mistakes: string[]
          note: string | null
          performance: Database["public"]["Enums"]["performance"]
          session_id: string | null
          skill: Database["public"]["Enums"]["skill"]
          topic: string
          updated_at: string
        }
        Insert: {
          class_id: string
          class_member_id: string
          created_at?: string
          created_by: string
          id?: string
          lesson_date: string
          mistakes?: string[]
          note?: string | null
          performance: Database["public"]["Enums"]["performance"]
          session_id?: string | null
          skill: Database["public"]["Enums"]["skill"]
          topic: string
          updated_at?: string
        }
        Update: {
          class_id?: string
          class_member_id?: string
          created_at?: string
          created_by?: string
          id?: string
          lesson_date?: string
          mistakes?: string[]
          note?: string | null
          performance?: Database["public"]["Enums"]["performance"]
          session_id?: string | null
          skill?: Database["public"]["Enums"]["skill"]
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_logs_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_logs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_logs_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "class_members"
            referencedColumns: ["id", "class_id"]
          },
          {
            foreignKeyName: "lesson_logs_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_attendance_summary"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "lesson_logs_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_current_band"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "lesson_logs_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_performance_status"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "lesson_logs_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_session_attendance"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "lesson_logs_session_fk"
            columns: ["session_id", "class_id"]
            isOneToOne: false
            referencedRelation: "class_sessions"
            referencedColumns: ["id", "class_id"]
          },
        ]
      }
      mistake_tags: {
        Row: {
          created_at: string
          id: string
          label: string
          skill: Database["public"]["Enums"]["skill"] | null
          teacher_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          skill?: Database["public"]["Enums"]["skill"] | null
          teacher_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          skill?: Database["public"]["Enums"]["skill"] | null
          teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mistake_tags_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_reports: {
        Row: {
          class_id: string
          class_member_id: string
          created_at: string
          generated_by: string
          id: string
          period_month: string
          published_at: string | null
          share_expires_at: string | null
          share_last_viewed_at: string | null
          share_revoked_at: string | null
          share_token_hash: string | null
          share_view_count: number
          shared_at: string | null
          snapshot: Json
          snapshot_version: number
          status: Database["public"]["Enums"]["report_status"]
          teacher_comment: string | null
          updated_at: string
        }
        Insert: {
          class_id: string
          class_member_id: string
          created_at?: string
          generated_by: string
          id?: string
          period_month: string
          published_at?: string | null
          share_expires_at?: string | null
          share_last_viewed_at?: string | null
          share_revoked_at?: string | null
          share_token_hash?: string | null
          share_view_count?: number
          shared_at?: string | null
          snapshot: Json
          snapshot_version?: number
          status?: Database["public"]["Enums"]["report_status"]
          teacher_comment?: string | null
          updated_at?: string
        }
        Update: {
          class_id?: string
          class_member_id?: string
          created_at?: string
          generated_by?: string
          id?: string
          period_month?: string
          published_at?: string | null
          share_expires_at?: string | null
          share_last_viewed_at?: string | null
          share_revoked_at?: string | null
          share_token_hash?: string | null
          share_view_count?: number
          shared_at?: string | null
          snapshot?: Json
          snapshot_version?: number
          status?: Database["public"]["Enums"]["report_status"]
          teacher_comment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_reports_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_reports_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "class_members"
            referencedColumns: ["id", "class_id"]
          },
          {
            foreignKeyName: "monthly_reports_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_attendance_summary"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "monthly_reports_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_current_band"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "monthly_reports_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_performance_status"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "monthly_reports_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_session_attendance"
            referencedColumns: ["class_member_id", "class_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          deactivated_at: string | null
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          teaching_type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          teaching_type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          email?: string
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          teaching_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      score_entries: {
        Row: {
          class_id: string
          class_member_id: string
          created_at: string
          created_by: string
          entry_type: Database["public"]["Enums"]["score_entry_type"]
          id: string
          listening: number | null
          note: string | null
          overall: number | null
          reading: number | null
          recorded_on: string
          speaking: number | null
          writing: number | null
        }
        Insert: {
          class_id: string
          class_member_id: string
          created_at?: string
          created_by: string
          entry_type?: Database["public"]["Enums"]["score_entry_type"]
          id?: string
          listening?: number | null
          note?: string | null
          overall?: number | null
          reading?: number | null
          recorded_on: string
          speaking?: number | null
          writing?: number | null
        }
        Update: {
          class_id?: string
          class_member_id?: string
          created_at?: string
          created_by?: string
          entry_type?: Database["public"]["Enums"]["score_entry_type"]
          id?: string
          listening?: number | null
          note?: string | null
          overall?: number | null
          reading?: number | null
          recorded_on?: string
          speaking?: number | null
          writing?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "score_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_entries_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "class_members"
            referencedColumns: ["id", "class_id"]
          },
          {
            foreignKeyName: "score_entries_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_attendance_summary"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "score_entries_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_current_band"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "score_entries_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_performance_status"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "score_entries_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_session_attendance"
            referencedColumns: ["class_member_id", "class_id"]
          },
        ]
      }
      session_attendance: {
        Row: {
          class_id: string
          class_member_id: string
          created_at: string
          id: string
          note: string | null
          recorded_by: string | null
          session_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at: string
        }
        Insert: {
          class_id: string
          class_member_id: string
          created_at?: string
          id?: string
          note?: string | null
          recorded_by?: string | null
          session_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
        }
        Update: {
          class_id?: string
          class_member_id?: string
          created_at?: string
          id?: string
          note?: string | null
          recorded_by?: string | null
          session_id?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_attendance_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "class_members"
            referencedColumns: ["id", "class_id"]
          },
          {
            foreignKeyName: "session_attendance_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_attendance_summary"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "session_attendance_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_current_band"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "session_attendance_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_performance_status"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "session_attendance_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_session_attendance"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "session_attendance_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_session_fk"
            columns: ["session_id", "class_id"]
            isOneToOne: false
            referencedRelation: "class_sessions"
            referencedColumns: ["id", "class_id"]
          },
        ]
      }
      teacher_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          due_date: string | null
          id: string
          priority: Database["public"]["Enums"]["task_priority"]
          teacher_id: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          teacher_id: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          teacher_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_tasks_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tuition_records: {
        Row: {
          amount_total: number | null
          class_id: string
          class_member_id: string
          created_at: string
          currency: string
          discount_amount: number
          id: string
          paid_at: string | null
          payment_method: string | null
          payment_note: string | null
          period_month: string
          rate_per_session: number
          reminder_count: number
          reminder_sent_at: string | null
          sessions_attended: number
          sessions_billed: number
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount_total?: number | null
          class_id: string
          class_member_id: string
          created_at?: string
          currency?: string
          discount_amount?: number
          id?: string
          paid_at?: string | null
          payment_method?: string | null
          payment_note?: string | null
          period_month: string
          rate_per_session: number
          reminder_count?: number
          reminder_sent_at?: string | null
          sessions_attended?: number
          sessions_billed?: number
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount_total?: number | null
          class_id?: string
          class_member_id?: string
          created_at?: string
          currency?: string
          discount_amount?: number
          id?: string
          paid_at?: string | null
          payment_method?: string | null
          payment_note?: string | null
          period_month?: string
          rate_per_session?: number
          reminder_count?: number
          reminder_sent_at?: string | null
          sessions_attended?: number
          sessions_billed?: number
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tuition_records_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "class_members"
            referencedColumns: ["id", "class_id"]
          },
          {
            foreignKeyName: "tuition_records_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_attendance_summary"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "tuition_records_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_current_band"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "tuition_records_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_performance_status"
            referencedColumns: ["class_member_id", "class_id"]
          },
          {
            foreignKeyName: "tuition_records_member_fk"
            columns: ["class_member_id", "class_id"]
            isOneToOne: false
            referencedRelation: "v_member_session_attendance"
            referencedColumns: ["class_member_id", "class_id"]
          },
        ]
      }
    }
    Views: {
      v_member_attendance_summary: {
        Row: {
          attendance_pct: number | null
          class_id: string | null
          class_member_id: string | null
          sessions_attended: number | null
          sessions_counted: number | null
        }
        Relationships: [
          {
            foreignKeyName: "class_members_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      v_member_current_band: {
        Row: {
          class_id: string | null
          class_member_id: string | null
          current_listening: number | null
          current_overall: number | null
          current_reading: number | null
          current_recorded_on: string | null
          current_speaking: number | null
          current_writing: number | null
          start_listening: number | null
          start_overall: number | null
          start_reading: number | null
          start_speaking: number | null
          start_writing: number | null
          target_band: number | null
        }
        Relationships: [
          {
            foreignKeyName: "class_members_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      v_member_performance_status: {
        Row: {
          class_id: string | null
          class_member_id: string | null
          status: Database["public"]["Enums"]["member_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "class_members_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      v_member_session_attendance: {
        Row: {
          attendance_status:
            | Database["public"]["Enums"]["attendance_status"]
            | null
          class_id: string | null
          class_member_id: string | null
          counts_in_denominator: boolean | null
          counts_in_numerator: boolean | null
          session_id: string | null
          starts_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_members_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      create_report_share_link: {
        Args: { p_report_id: string }
        Returns: string
      }
      generate_invite_code: { Args: { p_length?: number }; Returns: string }
      get_class_invite_preview: {
        Args: { p_code: string }
        Returns: {
          class_name: string
          course_type: Database["public"]["Enums"]["course_type"]
          end_date: string
          schedule_note: string
          scoring_model: Database["public"]["Enums"]["scoring_model"]
          start_date: string
          target_band: number
          teacher_name: string
        }[]
      }
      get_shared_report: {
        Args: { p_token: string }
        Returns: {
          class_name: string
          period_month: string
          published_at: string
          snapshot: Json
          snapshot_version: number
          student_name: string
          teacher_name: string
        }[]
      }
      join_class_with_code: {
        Args: { p_code: string }
        Returns: {
          class_id: string
          class_member_id: string
          class_name: string
        }[]
      }
      revoke_report_share_link: {
        Args: { p_report_id: string }
        Returns: undefined
      }
      submit_homework: {
        Args: { p_assignment_id: string }
        Returns: {
          status: Database["public"]["Enums"]["homework_status"]
          submission_id: string
          submitted_at: string
        }[]
      }
    }
    Enums: {
      app_role: "teacher" | "student"
      attendance_status: "present" | "absent" | "late" | "excused"
      course_type: "ielts" | "general_english" | "academic_english" | "other"
      homework_status: "assigned" | "submitted" | "graded" | "missed"
      join_status: "invited" | "joined" | "departed"
      member_status: "improving" | "stable" | "needs_attention"
      payment_status: "pending" | "paid" | "waived"
      performance: "excellent" | "good" | "developing" | "needs_attention"
      report_status: "draft" | "published"
      score_entry_type: "baseline" | "progress" | "mock_test"
      scoring_model: "ielts_band" | "none"
      session_status: "scheduled" | "completed" | "cancelled"
      skill: "reading" | "listening" | "writing" | "speaking" | "general"
      task_priority: "high" | "medium" | "low"
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
      app_role: ["teacher", "student"],
      attendance_status: ["present", "absent", "late", "excused"],
      course_type: ["ielts", "general_english", "academic_english", "other"],
      homework_status: ["assigned", "submitted", "graded", "missed"],
      join_status: ["invited", "joined", "departed"],
      member_status: ["improving", "stable", "needs_attention"],
      payment_status: ["pending", "paid", "waived"],
      performance: ["excellent", "good", "developing", "needs_attention"],
      report_status: ["draft", "published"],
      score_entry_type: ["baseline", "progress", "mock_test"],
      scoring_model: ["ielts_band", "none"],
      session_status: ["scheduled", "completed", "cancelled"],
      skill: ["reading", "listening", "writing", "speaking", "general"],
    },
  },
} as const

