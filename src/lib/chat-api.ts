import { supabase, SUPABASE_URL } from '@/lib/supabase';

export interface ConversationSummary {
  id: string;
  persona: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  persona: string | null;
  created_at: string;
}

export interface ChatResponse {
  conversation_id: string;
  message_id: string;
  content: string;
  persona: string;
}

export interface UsageEntry {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  created_at: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

const CHAT_URL = `${SUPABASE_URL}/functions/v1/namaa-chat`;
const CONV_URL = `${SUPABASE_URL}/functions/v1/namaa-conversations`;

export async function sendChatMessage(
  content: string,
  persona: 'ghaith' | 'nada',
  conversationId?: string,
): Promise<ChatResponse> {
  const headers = await authHeaders();
  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content, persona, conversation_id: conversationId }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The agronomy assistant could not reply.');
  return result as ChatResponse;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const headers = await authHeaders();
  const response = await fetch(CONV_URL, { headers });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to load conversations');
  return result.conversations as ConversationSummary[];
}

export async function loadConversation(id: string): Promise<{
  conversation: ConversationSummary;
  messages: ConversationMessage[];
}> {
  const headers = await authHeaders();
  const response = await fetch(`${CONV_URL}/${id}`, { headers });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to load conversation');
  return { conversation: result.conversation, messages: result.messages };
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const headers = await authHeaders();
  const response = await fetch(`${CONV_URL}/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw new Error('Failed to rename conversation');
}

export async function deleteConversation(id: string): Promise<void> {
  const headers = await authHeaders();
  const response = await fetch(`${CONV_URL}/${id}`, { method: 'DELETE', headers });
  if (!response.ok) throw new Error('Failed to delete conversation');
}

export async function submitFeedback(
  messageId: string,
  rating: number,
  feedback?: string,
): Promise<void> {
  const headers = await authHeaders();
  const response = await fetch(`${CONV_URL}/feedback`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message_id: messageId, rating, feedback }),
  });
  if (!response.ok) throw new Error('Failed to submit feedback');
}

export async function getUsage(): Promise<{
  usage: UsageEntry[];
  total_tokens: number;
  total_cost_usd: number;
}> {
  const headers = await authHeaders();
  const response = await fetch(`${CONV_URL}/usage`, { headers });
  const result = await response.json();
  if (!response.ok) throw new Error('Failed to load usage');
  return result;
}
