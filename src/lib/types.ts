export type Status = 'active' | 'away' | 'dnd';
export type Presence = 'active' | 'away' | 'dnd' | 'offline';
export type Theme = 'system' | 'light' | 'dark';
export type Role = 'owner' | 'admin' | 'member';

export interface Profile {
  id: string;
  display_name: string;
  description: string;
  avatar_url: string | null;
  status: Status;
  allow_messages_from: 'everyone' | 'nobody';
  show_read_receipts: boolean;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfilePrompt {
  question: string;
  answer: string;
}

export interface ProfileDetails {
  user_id: string;
  birth_date: string | null;
  class_year: string | null;
  major: string | null;
  hometown: string | null;
  here_for: string[];
  interests: string[];
  prompts: ProfilePrompt[];
  hidden_fields: string[];
}

/** What another member sees: age instead of birthday, hidden items removed. */
export interface PublicDetails {
  user_id: string;
  age: number | null;
  class_year: string | null;
  major: string | null;
  hometown: string | null;
  here_for: string[];
  interests: string[];
  prompts: ProfilePrompt[];
}

export interface UserSettings {
  user_id: string;
  theme: Theme;
  notify_desktop: boolean;
  notify_sound: boolean;
  enter_to_send: boolean;
  phone: string | null;
  layout: Record<string, unknown>;
}

export interface ProfilePhoto {
  id: string;
  user_id: string;
  storage_path: string;
  url: string;
  caption: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  description: string;
  avatar_url: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at: string;
}

export interface ConversationSummary {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  description: string;
  avatar_url: string | null;
  last_message_at: string;
  muted: boolean;
  locked: boolean;
  unread_count: number;
  member_count: number;
  last_body: string | null;
  last_has_image: boolean | null;
  last_deleted: boolean | null;
  last_sender_id: string | null;
  last_sender_name: string | null;
  other_user_id: string | null;
  other_display_name: string | null;
  other_avatar_url: string | null;
  other_status: Status | null;
}

export interface Member {
  conversation_id: string;
  user_id: string;
  role: Role;
  muted: boolean;
  last_read_at: string;
  joined_at: string;
  profile: Profile | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string;
  image_path: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  /** Client only: true while the message is still being sent. */
  pending?: boolean;
  /** Client only: local preview for an image that is uploading. */
  localImage?: string;
}
