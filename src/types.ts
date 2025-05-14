import type { MessageParam } from '@anthropic-ai/sdk/resources/messages/messages';

export type ConversationJobStatus = 
  | 'pending'
  | 'processing'
  | 'waiting_for_tool'
  | 'tool_complete'
  | 'completed'
  | 'failed';

export interface ConversationJob {
  id: string;
  message_id: string;
  profile_id: string;
  phone_number: string;
  request_text: string;
  status: ConversationJobStatus;
  current_step: number;
  total_steps: number;
  conversation_history: MessageParam[];
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
  result: unknown | null;
  status: 'pending' | 'completed' | 'failed';
  error_message: string | null;
} 