export type ConversationJobStatus = 
  | 'pending'
  | 'processing'
  | 'waiting_for_tool'
  | 'tool_complete'
  | 'completed'
  | 'failed';

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ConversationJob {
  id: string;
  message_id: string;
  profile_id: string;
  phone_number: string;
  request_text: string;
  status: ConversationJobStatus;
  current_step: number;
  total_steps: number;
  conversation_history: ConversationMessage[];
  tool_results: Record<string, unknown>[];
  final_response: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolCallState {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  tool_result: unknown | null | [];
} 